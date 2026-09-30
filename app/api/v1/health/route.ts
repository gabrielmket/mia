/**
 * GET /api/v1/health — Supabase, Redis e WAHA respondem?
 *
 * ─── Por que cada check diz a CAUSA, e não só "down" ─────────────────────────
 * A versão anterior devolvia `error: "fetch failed"` — a mensagem que o `fetch`
 * dá para causas opostas. Com ela, produção passou semanas indistinguível entre
 * "o endereço configurado não existe" e "o serviço caiu", e a leitura que
 * prevaleceu foi a segunda: o dono reiniciava, toda vez, um container que nunca
 * havia caído (medido: `restarts=0`). Um diagnóstico que não separa configuração
 * de disponibilidade manda metade das pessoas para o lugar errado — e sempre a
 * mesma metade, porque "o serviço caiu" é a hipótese que não acusa quem
 * configurou.
 *
 * `reason` é a classificação (ver `lib/net/alcance`), e é o que basta para saber
 * ONDE mexer.
 *
 * ─── Por que o ENDEREÇO só sai autenticado ───────────────────────────────────
 * Esta rota é pública — é o que permite um monitor externo bater nela. O endereço
 * do Redis e do WAHA é superfície de ataque: publicá-lo entrega a quem varre a
 * internet o alvo exato de dois serviços que falam com o WhatsApp do cliente.
 * Então `target` só sai com `?verbose=1` mais o mesmo segredo interno dos crons:
 * quem opera o sistema vê para onde ele tentou ir; quem só passa na frente, não.
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import {
  avaliarBackup,
  FUNCAO_DO_ESTADO_DO_BACKUP,
  type LeituraDoBackup,
  type LinhaDoEstadoDoBackup,
} from "@/lib/backup/estado-do-backup";
import { env } from "@/lib/env";
import { alvoDe, classificarFalhaDeAlcance, type FalhaDeAlcance } from "@/lib/net/alcance";
import { validarConfigRedisRest } from "@/lib/redis-config";
import { compararCarimbo, TABELA_DO_CARIMBO } from "@/lib/schema/carimbo";
import { urlDoSupabaseNoServidor } from "@/lib/supabase/url-do-servidor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CheckStatus = "ok" | "degraded" | "down";

/** Por que o check não passou. `credencial_recusada` é o 401/403 — chegamos lá, e fomos barrados. */
type MotivoDeFalha =
  | FalhaDeAlcance
  | "credencial_recusada"
  | "resposta_inesperada"
  | "nao_configurado"
  | "configuracao_invalida";

type Check = {
  status: CheckStatus;
  latency_ms: number;
  error?: string;
  reason?: MotivoDeFalha;
  /** Protocolo + host + porta que tentamos. Só com `?verbose=1` autenticado. */
  target?: string;
};

const TIMEOUT_MS = 3_000;

async function withTimeout<T>(p: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms),
    ),
  ]);
}

/** Chegamos ao serviço, ele respondeu, e a resposta não serve. */
function motivoDoStatusHttp(status: number): MotivoDeFalha {
  return status === 401 || status === 403 ? "credencial_recusada" : "resposta_inesperada";
}

async function checkSupabase(): Promise<Check> {
  const t0 = Date.now();
  // A sonda pergunta ao MESMO endereço que o app usa para falar com o banco, e
  // não ao público: com `SUPABASE_SERVER_URL` (#1082) preenchida, uma instalação
  // com Kong privado não tem REST publicado — a URL pública daria `down` com o
  // CRM inteiro funcionando ao lado. Sem a variável, é a pública, como sempre.
  const url = urlDoSupabaseNoServidor(env.SUPABASE_SERVER_URL, env.NEXT_PUBLIC_SUPABASE_URL);
  try {
    // Ping leve via REST com anon key — não precisa de service_role pra health check.
    // Se chegar 200/401/empty body, conexão e API key estão OK.
    const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const res = await withTimeout(
      fetch(`${url}/rest/v1/organizations?select=id&limit=1`, {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          // O SCHEMA VAI EXPLÍCITO, como o resto do app faz.
          //
          // Este `fetch` é cru, então ele cai no schema DEFAULT do PostgREST —
          // o primeiro da lista "Exposed schemas" do projeto. Que esse default
          // seja `public` é costume de projeto novo, não garantia do Supabase:
          // num projeto que já servia outra aplicação (schema próprio primeiro
          // na lista), o ping procurava `<outro>.organizations`, levava
          // `404 PGRST205` e o check declarava o banco `down` — com o CRM
          // atendendo normalmente ao lado.
          //
          // Não é falso alarme de menos importância: `update.sh` termina em
          // `wait_app_healthy`, e sair diferente de zero é o sinal que o
          // `agent.sh` usa para REVERTER a imagem. Uma atualização boa era
          // desfeita por uma configuração de painel que o CRM não controla.
          //
          // Nenhum client do CRM declara `db.schema` (`lib/supabase/*.ts`), e o
          // default do supabase-js é `public` — então é `public` que o app
          // usa de verdade, e é o que esta sonda tem de perguntar para estar
          // medindo o mesmo banco que o app enxerga.
          "Accept-Profile": "public",
        },
        cache: "no-store",
      }),
    );
    // 200 (lista vazia por RLS) ou 401/403 (auth ok mas RLS bloqueia anon) → conexão OK
    if (res.status === 200 || res.status === 401 || res.status === 403) {
      return { status: "ok", latency_ms: Date.now() - t0, target: alvoDe(url) };
    }
    return {
      status: "down",
      latency_ms: Date.now() - t0,
      error: `http_${res.status}`,
      reason: motivoDoStatusHttp(res.status),
      target: alvoDe(url),
    };
  } catch (e) {
    return {
      status: "down",
      latency_ms: Date.now() - t0,
      error: e instanceof Error ? e.message : String(e),
      reason: classificarFalhaDeAlcance(e),
      target: alvoDe(url),
    };
  }
}

async function checkRedis(): Promise<Check> {
  const t0 = Date.now();
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;

  /**
   * A FORMA do valor vem antes da ida à rede, e o motivo é o que quem opera faz
   * a seguir.
   *
   * Um `.env` com as aspas sobrando (`URL="https://srh:80"`) hoje chega até o
   * `fetch`, falha, e o `reason` que sai é o de alcance — indistinguível do
   * contêiner do Redis realmente parado. As duas leituras mandam o operador
   * para lugares opostos: uma para reiniciar um serviço que está de pé, a outra
   * para o editor. `configuracao_invalida` separa as duas SEM ida à rede.
   *
   * Só "não configurado" segue `degraded`: é integração que ninguém contratou.
   * Configurado errado é `down` — o produto conta com o Redis e não o tem.
   *
   * O texto continua carregando o endereço de propósito: `semAlvo()` o redige
   * para quem não tem o segredo interno, e quem tem precisa ver QUAL valor está
   * malformado — dizer só "inválido" sem dizer qual não conserta nada.
   */
  const config = validarConfigRedisRest(url, token);
  if (!config.ok) {
    if (config.reason === "nao_configurado") {
      return { status: "degraded", latency_ms: 0, error: "not_configured", reason: "nao_configurado" };
    }
    return {
      status: "down",
      latency_ms: 0,
      error: `configuracao_invalida: UPSTASH_REDIS_REST_URL=${url}`,
      reason: "configuracao_invalida",
      target: alvoDe(url),
    };
  }
  try {
    // Protocolo REST do Upstash (compatível com serverless-redis-http): comando no
    // corpo via POST na raiz. NÃO existe GET /ping — daria 404 no SRH self-host.
    const res = await withTimeout(
      fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(["PING"]),
        cache: "no-store",
      }),
    );
    if (!res.ok) {
      return {
        status: "down",
        latency_ms: Date.now() - t0,
        error: `http_${res.status}`,
        reason: motivoDoStatusHttp(res.status),
        target: alvoDe(url),
      };
    }
    return { status: "ok", latency_ms: Date.now() - t0, target: alvoDe(url) };
  } catch (e) {
    return {
      status: "down",
      latency_ms: Date.now() - t0,
      error: e instanceof Error ? e.message : String(e),
      reason: classificarFalhaDeAlcance(e),
      target: alvoDe(url),
    };
  }
}

async function checkWaha(): Promise<Check> {
  const t0 = Date.now();
  const base = env.WAHA_API_BASE_URL;
  if (!base) {
    return { status: "degraded", latency_ms: 0, error: "not_configured", reason: "nao_configurado" };
  }
  try {
    // /api/sessions valida conectividade E autenticação num tiro só. O WAHA Core não
    // expõe /api/health (daria 404 mesmo autenticado).
    const res = await withTimeout(
      fetch(`${base.replace(/\/$/, "")}/api/sessions`, {
        headers: env.WAHA_API_KEY ? { "X-Api-Key": env.WAHA_API_KEY } : {},
        cache: "no-store",
      }),
    );
    if (!res.ok) {
      return {
        status: "down",
        latency_ms: Date.now() - t0,
        error: `http_${res.status}`,
        reason: motivoDoStatusHttp(res.status),
        target: alvoDe(base),
      };
    }
    return { status: "ok", latency_ms: Date.now() - t0, target: alvoDe(base) };
  } catch (e) {
    return {
      status: "down",
      latency_ms: Date.now() - t0,
      error: e instanceof Error ? e.message : String(e),
      reason: classificarFalhaDeAlcance(e),
      target: alvoDe(base),
    };
  }
}

/**
 * O segredo interno dos crons também abre o modo verboso. Mesmo contrato de
 * `/api/v1/system/agent`: Bearer, comparação em tempo constante, e segredo vazio
 * nunca vira credencial válida.
 */
function segredoInternoConfere(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const fornecido = bearer || (req.headers.get("x-cron-secret")?.trim() ?? "");
  if (!fornecido) return false;
  const aceitos = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  return aceitos.some((esperado) => {
    const a = Buffer.from(fornecido);
    const b = Buffer.from(esperado);
    // timingSafeEqual LANÇA se os tamanhos diferirem.
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

/**
 * Sem o segredo, o endereço não sai — nem pelo `target`, nem pelo `error`.
 *
 * O `target` sempre foi escondido de propósito: esta rota é PÚBLICA (o `GET` não
 * exige nada; o segredo interno só destrava o `?verbose=1`), e o cabeçalho deste
 * arquivo chama o endereço de WAHA e Redis do cliente de superfície de ataque.
 * Mas o `error` saía cru ao lado dele, e ele carrega o mesmo endereço numa das
 * formas mais comuns de configuração errada.
 *
 * Medido, com valores que passam pelo Zod de `lib/env.ts` — porque só
 * `NEXT_PUBLIC_SUPABASE_URL` é `.url()` (linha 69); `WAHA_API_BASE_URL` (140) e
 * `UPSTASH_REDIS_REST_URL` (155) são `required()` puro, sem validação de forma:
 *
 *   "redis-interno.hostgator-vps.com"
 *     -> e.message = "Failed to parse URL from redis-interno.hostgator-vps.com"
 *   `"https://redis-interno.hostgator-vps.com"`  (aspas sobrando no .env)
 *     -> e.message = "Failed to parse URL from \"https://redis-interno...\""
 *
 * Ou seja: exatamente os dois serviços cujo endereço a rota esconde por decisão
 * escrita, e exatamente a instalação self-host que erra o `.env` — o caso já
 * catalogado nesta casa como ".env sem aspas". O `error` publicava pela porta
 * que a redação do `target` fechou.
 *
 * Contra-exemplo medido, para o escopo ficar honesto: um endereço com esquema
 * válido e host inalcançável devolve `"fetch failed"`, e o host mora em
 * `e.cause`, que esta rota nunca devolveu. O vazamento é da forma MALFORMADA,
 * não de toda falha — e é por isso que a troca é de redação, não de remoção.
 *
 * O que NÃO se perde: `reason` (`classificarFalhaDeAlcance`) continua saindo
 * inteiro, então quem monitora de fora segue distinguindo dns, recusa, tempo
 * esgotado e credencial recusada. E quem tem o segredo continua vendo o texto
 * original, porque `verbose=1` não passa por aqui.
 */
function semAlvo(check: Check): Check {
  const { target: _oculto, error, ...resto } = check;
  return error === undefined ? resto : { ...resto, error: "erro_ao_consultar" };
}

/**
 * O banco recebeu o mesmo baseline que esta imagem espera?
 *
 * ── Por que esta pergunta precisa de resposta pública ─────────────────────
 *
 * `easypanel/bootstrap.sh` aplica o baseline com `|| true` num banco existente
 * — que é todo deploy depois do primeiro. Se uma migration tropeça, ele escreve
 * `AVISO: ... (o app sobe mesmo assim)` e segue. O produto então sobe saudável,
 * com o código novo e o schema de ontem, e as duas afirmações são verdadeiras.
 * O único registro é o stdout de um contêiner efêmero, e a agregação de logs da
 * VPS está desligada (item E4).
 *
 * ── `em_dia: false` NÃO derruba a saúde ───────────────────────────────────
 *
 * Um schema atrasado não impede o produto de atender — impede a feature NOVA de
 * funcionar. Devolver 503 tiraria do ar um sistema que está servindo, e o monitor
 * externo chamaria alguém de madrugada para um problema que espera o expediente.
 * O campo fica visível e o alerta é escolha de quem monitora.
 *
 * Falha de leitura vira `no_banco: null` → `em_dia: false`. Não sabemos e não
 * fingimos que sim: é exatamente o caso em que o baseline pode não ter passado.
 */
/**
 * ⚠️ `fetch` cru no PostgREST, e NÃO o client do Supabase — o mesmo caminho que
 * `checkSupabase` acima. A primeira versão usava `createAdminClient()` e custou
 * um teste: com um host que não resolve, as checagens por `fetch` morrem no DNS
 * em milissegundos e o client JS ficava pendurado até os 3s do `withTimeout`.
 * Numa rota que um monitor externo consulta de minuto em minuto, isso é três
 * segundos de parede a cada batida, exatamente quando o banco está fora do ar.
 * Pego por `tests/unit/health-separa-env-errado-de-servico-caido.test.ts`, que
 * mede a AUSÊNCIA de ida à rede — e estava medindo a minha.
 *
 * O endereço também é o do `checkSupabase`: `urlDoSupabaseNoServidor` (#1082 do
 * upstream). Com `SUPABASE_SERVER_URL` preenchida, a instalação pode ter o Kong
 * privado e o REST não publicado; o carimbo lido pela URL pública voltaria vazio
 * e o health responderia `em_dia: false` com o banco em dia ao lado. Pego por
 * `tests/unit/supabase-server-url-opcional.test.ts`, que exige que NADA desta
 * rota vá à URL pública quando a do servidor existe.
 */
interface LinhaDoCarimbo {
  migration: string | null;
  erros: number;
  amostra: string | null;
}

async function lerCarimboDoSchema(): Promise<LinhaDoCarimbo> {
  const vazio: LinhaDoCarimbo = { migration: null, erros: 0, amostra: null };
  const url = urlDoSupabaseNoServidor(env.SUPABASE_SERVER_URL, env.NEXT_PUBLIC_SUPABASE_URL);
  const chave = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) return vazio;
  try {
    const res = await withTimeout(
      fetch(
        `${url}/rest/v1/${TABELA_DO_CARIMBO}?select=migration_mais_nova,erros_inesperados,erros_amostra&id=eq.1&limit=1`,
        {
          headers: { apikey: chave, Authorization: `Bearer ${chave}` },
          cache: "no-store",
        },
      ),
    );
    if (!res.ok) return vazio;
    const linhas = (await res.json()) as Array<{
      migration_mais_nova?: string | null;
      erros_inesperados?: number | null;
      erros_amostra?: string | null;
    }>;
    const linha = Array.isArray(linhas) ? linhas[0] : undefined;
    if (!linha) return vazio;
    return {
      migration: linha.migration_mais_nova ?? null,
      // Ausente vira 0 e não "desconhecido": um banco anterior à 0269 não tem a
      // coluna, e transformar isso em alarme faria toda instalação correta
      // acusar problema na primeira leitura. O que ela AINDA tem é o carimbo,
      // que continua respondendo a metade principal da pergunta.
      erros: typeof linha.erros_inesperados === "number" ? linha.erros_inesperados : 0,
      amostra: linha.erros_amostra ?? null,
    };
  } catch {
    return vazio;
  }
}

/**
 * FORK MIA (.62) — o backup diário do banco está em dia?
 *
 * Lido pela função `fn_mia_estado_do_backup()` (migration 9006), e não pela
 * tabela: `operacao.backup` não é do app e carrega o texto de erro de cada
 * falha. A função devolve só a situação e duas datas, e a regra de `em_dia`
 * mora em `lib/backup/estado-do-backup.ts` (a mesma que o vigia interno usa).
 *
 * Mesmo caminho do carimbo: `fetch` cru no PostgREST do SERVIDOR, com o
 * `service_role` (o único papel com EXECUTE na função) e o mesmo teto de tempo.
 * GET porque a função é `stable`, e com `Accept-Profile: public` pela mesma
 * razão do ping do banco — o schema default do projeto pode não ser `public`.
 *
 * Nada aqui derruba a saúde: sem a função, sem a tabela ou com a leitura
 * falhando, o bloco diz `desconhecido` e o motivo, e o `status` da rota não
 * muda. Backup atrasado não impede o produto de atender; o alarme é de quem
 * monitora (o n8n lê `backup.em_dia`) e do vigia interno.
 */
async function lerEstadoDoBackup(): Promise<LeituraDoBackup> {
  const url = urlDoSupabaseNoServidor(env.SUPABASE_SERVER_URL, env.NEXT_PUBLIC_SUPABASE_URL);
  const chave = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) return { falha: "nao_configurado" };
  try {
    const res = await withTimeout(
      fetch(`${url}/rest/v1/rpc/${FUNCAO_DO_ESTADO_DO_BACKUP}`, {
        headers: { apikey: chave, Authorization: `Bearer ${chave}`, "Accept-Profile": "public" },
        cache: "no-store",
      }),
    );
    // 404 é o PostgREST dizendo que a função não existe (PGRST202): o baseline
    // da 9006 não passou. Diferente de "não consegui perguntar".
    if (res.status === 404) return { falha: "sem_funcao" };
    if (!res.ok) return { falha: "falha_de_leitura" };
    const linhas = (await res.json()) as unknown;
    const linha = Array.isArray(linhas) ? (linhas[0] as LinhaDoEstadoDoBackup | undefined) : undefined;
    if (!linha || typeof linha.situacao !== "string") return { falha: "falha_de_leitura" };
    return {
      situacao: linha.situacao,
      ultima_copia_em: linha.ultima_copia_em ?? null,
      enviada_em: linha.enviada_em ?? null,
    };
  } catch {
    return { falha: "falha_de_leitura" };
  }
}

export async function GET(req: NextRequest) {
  const [supabase, redis, waha, carimbo, backup] = await Promise.all([
    checkSupabase(),
    checkRedis(),
    checkWaha(),
    lerCarimboDoSchema(),
    lerEstadoDoBackup(),
  ]);

  const verboso = req.nextUrl.searchParams.get("verbose") === "1" && segredoInternoConfere(req);
  const filtrar = verboso ? (c: Check) => c : semAlvo;
  const checks = { supabase: filtrar(supabase), redis: filtrar(redis), waha: filtrar(waha) };

  const anyDown = Object.values(checks).some((c) => c.status === "down");
  const anyDegraded = Object.values(checks).some((c) => c.status === "degraded");
  const status: "healthy" | "degraded" | "unhealthy" = anyDown
    ? "unhealthy"
    : anyDegraded
      ? "degraded"
      : "healthy";

  const httpStatus = status === "unhealthy" ? 503 : 200;

  return NextResponse.json(
    {
      data: {
        status,
        // APP_VERSION é injetada no build da imagem (ARG no Dockerfile) e vale
        // "1.2.3" numa release, ou o SHA curto fora de tag.
        //
        // Antes isto era `process.env.npm_package_version ?? "0.1.0"`, e a
        // variável só existe quando o processo nasce de um `npm`/`pnpm run`. O
        // CMD da imagem é `node server.js`: TODA instalação do mundo reportava
        // "0.1.0". Um campo que responde o valor errado com confiança é pior que
        // um campo ausente — ele desliga a pergunta em vez de deixá-la aberta.
        // Por isso o fallback agora é "desconhecido", e não um número plausível.
        version: process.env.APP_VERSION || "desconhecido",
        // O NOME da migration só sai autenticado, pela mesma razão que o
        // endereço do Redis: ele conta a um scanner quando o schema mudou e o
        // que entrou. `em_dia` é o que um monitor externo precisa, e sozinho não
        // entrega nada — é um booleano sobre a coerência da própria instalação.
        schema: (() => {
          const lido = compararCarimbo(carimbo.migration, carimbo.erros, carimbo.amostra);
          // A AMOSTRA nunca sai sem o segredo: mensagem de erro de Postgres
          // carrega nome de tabela, de coluna e às vezes o valor que violou a
          // constraint. O CONTADOR sai — é um número sobre a coerência da
          // própria instalação, e sem ele `em_dia: false` não diz se o banco
          // está atrasado ou se o baseline tropeçou.
          return verboso
            ? lido
            : { em_dia: lido.em_dia, erros: lido.erros };
        })(),
        // FORK MIA (.62). Igual com e sem o segredo: datas e códigos, nenhum
        // texto de erro do backup (esse fica em `operacao.backup.detalhe`, que
        // a função da 9006 não devolve). `em_dia: null` = desconhecido.
        backup: avaliarBackup(backup, new Date()),
        timestamp: new Date().toISOString(),
        checks,
      },
    },
    { status: httpStatus },
  );
}
