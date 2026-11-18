/**
 * FORK MIA — os SERVIDORES MCP DE UM AGENTE pelo MCP de plataforma (upstream:
 * migration 9095, `ai_agent_mcp_servers`, seção "Servidores MCP" da tela do
 * agente). Entra como o campo `servidores_mcp` de `plataforma_garantir_agente`
 * e como a lista `servidores_mcp` de cada agente em `plataforma_ver_agentes`.
 *
 * ── O caminho da tela que isto espelha ────────────────────────────────────
 *
 * `salvarServidorMcpDoAgente` e `removerServidorMcpDoAgente`
 * (`app/actions/agents/servidoresMcpDoAgente.ts`): o módulo opcional
 * `mcp_por_agente` ligado, a entrada pela régua `EntradaDoServidorSchema`, o
 * endereço por `conferirEndpointDoServidor` (anti-SSRF), o teto de cinco
 * servidores, o slug que nasce do nome e não muda, a chave e o `client_secret`
 * cifrados (`cifrar`), a descoberta OAuth (`descobrir`) e o registro dinâmico
 * (`registrarCliente`) com o endereço de retorno DESTE servidor, a revogação
 * dos acessos dos contatos quando a origem dos tokens muda ou o servidor sai
 * (`revogarAcessosDoServidor`), e as auditorias `agent.mcp_servidor_salvo` e
 * `agent.mcp_servidor_removido` com a FORMA (servidor, modo, host). As peças
 * são as mesmas importadas pela ação; o que muda é só a autenticação (o token
 * de plataforma no lugar da sessão de administrador).
 *
 * ── O que nunca sai daqui ─────────────────────────────────────────────────
 *
 * A chave e o `client_secret` entram e não voltam: o retrato diz só se há
 * chave e os quatro últimos caracteres dela, e se há `client_secret`. O
 * endereço volta só como host, como no servidor da organização (.81). Os
 * tokens dos CONTATOS (`contato_mcp_credenciais`) nunca passam por aqui: quem
 * autoriza é cada contato, no navegador, pelo link que a IA manda na conversa.
 *
 * ── O passo que é de uma pessoa ───────────────────────────────────────────
 *
 * Duas coisas do OAuth não se fazem pelo MCP, e voltam como itens
 * `com_o_humano`, sem tentar sozinho: registrar o aplicativo no sistema de
 * fora quando ele não aceita registro automático (aí ninguém tem `client_id`
 * ainda, e o servidor NÃO é gravado, como na tela), e a autorização de cada
 * contato. Para o endereço de retorno ser o mesmo entre a chamada que pede o
 * registro e a que traz o `client_id`, o id do servidor novo é DERIVADO de
 * (organização, nome do agente, nome do servidor, endereço): a mesma chamada
 * calcula o mesmo id.
 */
import { createHash, randomUUID } from "node:crypto";

import { audit } from "@/lib/audit";
import { marcaDaSaida } from "@/lib/branding/saida";
import { FRASE_DA_DEMONSTRACAO } from "@/lib/demonstracao/trava";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { Recusa } from "@/lib/mcp-plataforma/recusa";
import { apagado, cifrar, ultimos4 } from "@/lib/mcp/servidor-externo/cifra";
import { urlDoCallbackMcp } from "@/lib/mcp/servidor-externo/do-agente/enderecos";
import { descobrir, ErroDeOauth, registrarCliente, type CodigoDeErroOauth } from "@/lib/mcp/servidor-externo/do-agente/oauth";
import {
  conferirEndpointDoServidor,
  EntradaDoServidorSchema,
  LIMITE_DE_SERVIDORES_POR_AGENTE,
  lerServidoresDoAgente,
  slugDoNome,
  type MetadadosOauth,
  type ModoDeAutenticacao,
  type ServidorDoAgente,
  type ServidorDoAgenteComSegredo,
} from "@/lib/mcp/servidor-externo/do-agente/registro";
import { revogarAcessosDoServidor } from "@/lib/mcp/servidor-externo/do-agente/revogacao";
import { escolhasDoServidor, toolIdRemoto } from "@/lib/mcp/servidor-externo/ids";
import { hostDoEndpoint } from "@/lib/mcp/servidor-externo/registro";

import { chaveDoNome, type Implantacao, type OrganizacaoDaImplantacao } from "./base";

/** Um item de `servidores_mcp` em `plataforma_garantir_agente`. Só o que VEIO muda. */
export interface PedidoDeServidorMcp {
  /** O nome do servidor no agente. É a chave: o mesmo nome altera o mesmo servidor. */
  nome: string;
  endereco?: string;
  autenticacao?: ModoDeAutenticacao;
  /** Só em `chave_estatica`. Entra cifrada e nunca volta. */
  chave?: string;
  /** Só em `oauth_por_contato`, quando o sistema de fora não aceita registro automático. */
  oauth_client_id?: string;
  /** Idem. Entra cifrado e nunca volta. */
  oauth_client_secret?: string;
  escopos?: string[];
  escrita_delegada?: boolean;
  retencao_horas?: number;
  ativo?: boolean;
  /** A lista INTEIRA das ferramentas deste servidor no rascunho ([] tira todas). */
  ferramentas?: Array<{ nome: string; leitura?: boolean }>;
  /** `true` tira o servidor do agente (revoga antes os acessos dos contatos). */
  apagar?: boolean;
}

export type DesfechoDoServidor = "criou" | "atualizou" | "ja_estava" | "apagou" | "com_o_humano";

/** O passo que é de uma pessoa: o MCP não faz e diz quem faz. */
export interface ItemComOHumano {
  servidor: string;
  quem: "uma pessoa da empresa" | "cada contato, na conversa";
  o_que: string;
  como: string;
}

/** O servidor como a leitura e a resposta o mostram: sem segredo, endereço só como host. */
export interface RetratoDoServidorMcp {
  id: string;
  nome: string;
  host: string;
  autenticacao: ModoDeAutenticacao;
  ativo: boolean;
  chave: { configurada: boolean; termina_em: string | null } | null;
  oauth: {
    client_id: string | null;
    client_secret: "configurado" | null;
    registro_automatico: boolean;
    emissor: string | null;
    escopos: string[];
    escrita_delegada: boolean;
    retencao_horas: number;
    endereco_de_retorno: string;
  } | null;
}

export function retratoDoServidorMcp(s: ServidorDoAgente): RetratoDoServidorMcp {
  return {
    id: s.id,
    nome: s.nome,
    host: hostDoEndpoint(s.endpoint),
    autenticacao: s.modo,
    ativo: s.ativo,
    chave: s.modo === "chave_estatica" ? { configurada: s.chaveLast4 !== null, termina_em: s.chaveLast4 } : null,
    oauth:
      s.modo === "oauth_por_contato"
        ? {
            client_id: s.oauthClientId,
            client_secret: s.temClientSecret && !s.oauth?.cliente_dinamico ? "configurado" : null,
            registro_automatico: s.oauth?.cliente_dinamico ?? false,
            emissor: s.oauth ? hostDoEndpoint(s.oauth.emissor) : null,
            escopos: s.escoposPedidos,
            escrita_delegada: s.escritaDelegada,
            retencao_horas: s.retencaoHoras,
            endereco_de_retorno: urlDoCallbackMcp(s.id),
          }
        : null,
  };
}

/** O que a leitura mostra de cada servidor do agente: o retrato e as ferramentas escolhidas na versão. */
export function servidoresNaLeitura(
  servidores: readonly ServidorDoAgente[],
  toolIds: readonly string[],
): Array<RetratoDoServidorMcp & { ferramentas: Array<{ nome: string; leitura: boolean }> }> {
  return servidores.map((s) => ({
    ...retratoDoServidorMcp(s),
    ferramentas: escolhasDoServidor(toolIds, s.id).map((e) => ({ nome: e.nome, leitura: e.leitura })),
  }));
}

// ---------------------------------------------------------------------------
// o plano: tudo que pode recusar, e a rede da descoberta, ANTES de gravar
// ---------------------------------------------------------------------------

interface PassoDoServidor {
  nome: string;
  acao: "criar" | "atualizar" | "apagar" | "nada" | "com_o_humano";
  id: string;
  atual: ServidorDoAgenteComSegredo | null;
  colunas: Record<string, unknown>;
  slug: string;
  revogarAntes: boolean;
  /** Os ids de `tool_ids` deste servidor, quando o pedido trouxe `ferramentas`. */
  toolIds?: string[];
  comOHumano: ItemComOHumano[];
}

export interface PlanoDosServidores {
  passos: PassoDoServidor[];
}

const FRASE_DO_OAUTH: Record<CodigoDeErroOauth, string> = {
  descoberta_falhou:
    "não achei o servidor de autorização dele (o endereço não publica os metadados OAuth das RFC 9728 e 8414). Confira o endereço com quem cuida do sistema de fora",
  sem_s256: "o servidor de autorização dele não aceita PKCE com S256, que é obrigatório",
  metadados_divergentes: "os metadados OAuth dele não batem com o endereço (o recurso ou o emissor apontam para outro lugar)",
  sem_cliente: "ele não aceita registro automático de aplicativo",
  registro_falhou: "o registro automático do aplicativo foi recusado pelo sistema de fora",
  invalid_grant: "o sistema de fora recusou a autorização",
  recusado: "o sistema de fora recusou o pedido",
  rede: "o sistema de fora não respondeu",
};

/**
 * O id do servidor novo, o mesmo para o mesmo (organização, NOME do agente,
 * nome do servidor, endereço). O nome do agente, e não o id: o agente novo
 * ainda não tem id quando a primeira chamada calcula o endereço de retorno, e
 * o nome é a chave dele no MCP (não se repete na organização).
 */
function idDerivado(orgId: string, nomeDoAgente: string, nome: string, endpoint: string): string {
  const h = createHash("sha256")
    .update(`mia:servidor-mcp-do-agente:${orgId}:${chaveDoNome(nomeDoAgente)}:${chaveDoNome(nome)}:${endpoint}`)
    .digest("hex");
  // Forma de UUID v4 (versão 4, variante 10): passa no UUID da tela e do banco.
  const variante = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variante}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function idsDasFerramentas(nomeDoServidor: string, servidorId: string, pedidas: ReadonlyArray<{ nome: string; leitura?: boolean }>): string[] {
  const vistas = new Set<string>();
  const ids: string[] = [];
  for (const f of pedidas) {
    const nome = f.nome.trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(nome)) {
      throw new Recusa(
        `\`servidores_mcp\` «${nomeDoServidor}», \`ferramentas\`: «${f.nome}» não é um nome de ferramenta MCP (letras, números, _ e -, até 64). ` +
          "Use o nome exato que o servidor anuncia (a tela do agente, em Servidores MCP, mostra a lista).",
      );
    }
    if (vistas.has(nome)) continue;
    vistas.add(nome);
    ids.push(toolIdRemoto(nome, f.leitura === false ? "escrita" : "leitura", servidorId));
  }
  return ids;
}

/**
 * Confere o pedido inteiro e faz a rede da descoberta e do registro dinâmico,
 * sem gravar nada. `agente.id` nulo = o agente ainda vai nascer (nenhum
 * servidor existe). Recusa antes de qualquer escrita: módulo desligado, demonstração,
 * endereço inseguro, teto de servidores, entrada fora da régua da tela.
 */
export async function planejarServidoresDoAgente(
  c: Implantacao,
  org: Pick<OrganizacaoDaImplantacao, "demonstracao" | "display_name">,
  agente: { id: string | null; nome: string },
  pedidos: readonly PedidoDeServidorMcp[],
): Promise<PlanoDosServidores> {
  if (!(await moduloLigado(c.admin, "mcp_por_agente"))) {
    throw new Recusa(
      'O módulo opcional "Servidores MCP por agente" está DESLIGADO nesta instalação: a seção some da tela do agente e o turno não monta servidor do agente. ' +
        "Quem liga é quem opera a plataforma (Admin › Sistema, módulos opcionais); o MCP não liga módulo. Nada foi gravado. " +
        "O servidor MCP externo da EMPRESA (plataforma_configurar_servidor_mcp_externo e `servidor_mcp_externo` aqui) não depende dele.",
    );
  }
  const chaves = pedidos.map((p) => chaveDoNome(p.nome));
  const repetido = chaves.find((k, i) => chaves.indexOf(k) !== i);
  if (repetido !== undefined) {
    throw new Recusa(`\`servidores_mcp\`: o servidor «${pedidos[chaves.indexOf(repetido)]!.nome}» veio duas vezes. Mande um item por servidor.`);
  }
  if (org.demonstracao && pedidos.some((p) => p.apagar !== true)) {
    throw new Recusa(
      `${FRASE_DA_DEMONSTRACAO} O agente da demonstração não ganha servidor MCP (é a IA consultando o sistema de outra empresa pela rede). Tirar (\`apagar: true\`) continua valendo.`,
    );
  }

  const existentes = agente.id ? await lerServidoresDoAgente(c.admin, c.orgId, agente.id) : [];
  let quantos = existentes.length;
  const slugsOcupados = new Set(existentes.map((s) => s.slug));
  const passos: PassoDoServidor[] = [];

  for (const pedido of pedidos) {
    const nome = pedido.nome.trim();
    const atual = existentes.find((s) => chaveDoNome(s.nome) === chaveDoNome(nome)) ?? null;
    const base = { nome, atual, colunas: {}, revogarAntes: false, comOHumano: [] as ItemComOHumano[] };

    if (pedido.apagar === true) {
      passos.push({ ...base, acao: atual ? "apagar" : "nada", id: atual?.id ?? "", slug: atual?.slug ?? "", revogarAntes: atual?.modo === "oauth_por_contato" });
      continue;
    }

    if (!atual && (pedido.endereco === undefined || pedido.autenticacao === undefined)) {
      throw new Recusa(
        `O servidor «${nome}» ainda não existe neste agente: para criar, informe \`endereco\` e \`autenticacao\` ("nenhuma", "chave_estatica" com \`chave\`, ou "oauth_por_contato"). ` +
          'Ex.: { "nome": "Pedidos", "endereco": "https://pedidos.example.com/mcp", "autenticacao": "chave_estatica", "chave": "<a chave que o sistema deu>" }',
      );
    }
    if (!atual && quantos >= LIMITE_DE_SERVIDORES_POR_AGENTE) {
      throw new Recusa(
        `O agente já tem ${LIMITE_DE_SERVIDORES_POR_AGENTE} servidores MCP, o teto (cada um é rede em toda resposta). Tire um com \`apagar: true\` antes de pôr «${nome}». Nada foi gravado.`,
      );
    }

    const modo = pedido.autenticacao ?? atual!.modo;
    const endpoint = (pedido.endereco ?? atual!.endpoint).trim();
    const lido = EntradaDoServidorSchema.safeParse({
      nome,
      endpoint,
      modo,
      chave: pedido.chave ?? "",
      oauthClientId: pedido.oauth_client_id ?? "",
      oauthClientSecret: pedido.oauth_client_secret ?? "",
      escoposPedidos: modo === "oauth_por_contato" ? (pedido.escopos ?? atual?.escoposPedidos ?? []) : [],
      escritaDelegada: modo === "oauth_por_contato" ? (pedido.escrita_delegada ?? atual?.escritaDelegada ?? false) : false,
      retencaoHoras: pedido.retencao_horas ?? atual?.retencaoHoras ?? 0,
      ativo: pedido.ativo ?? atual?.ativo ?? true,
    });
    if (!lido.success) {
      const escritaSemOauth = pedido.escrita_delegada === true && modo !== "oauth_por_contato";
      throw new Recusa(
        escritaSemOauth
          ? `O servidor «${nome}»: \`escrita_delegada\` só existe com \`autenticacao: "oauth_por_contato"\` (a escrita sai com a credencial do PRÓPRIO contato).`
          : `O servidor «${nome}» não passou na conferência da tela: o nome tem de 1 a 80 caracteres, o endereço é completo (até 2048), os escopos são palavras sem espaço (até 50) e a retenção vai de 0 a 720 horas.`,
      );
    }
    const entrada = lido.data;
    try {
      conferirEndpointDoServidor(entrada.endpoint);
    } catch {
      throw new Recusa(
        `Endereço do servidor «${nome}» recusado por segurança: informe um servidor público, sem rede interna, sem localhost, sem usuário e senha e sem nada depois de \`?\` ou \`#\`. ` +
          "A chave vai no campo `chave`.",
      );
    }

    const derivado = idDerivado(c.orgId, agente.nome, nome, entrada.endpoint);
    const id = atual?.id ?? (existentes.some((s) => s.id === derivado) ? randomUUID() : derivado);
    let slug = atual?.slug ?? slugDoNome(nome);
    if (!atual) {
      for (let n = 2; slugsOcupados.has(slug); n += 1) slug = `${slugDoNome(nome).slice(0, 14)}${n}`;
    }

    // ── as colunas, na mesma conta de `salvarServidorMcpDoAgente` ──────────
    const colunas: Record<string, unknown> = {
      nome: entrada.nome,
      endpoint: entrada.endpoint,
      modo_autenticacao: entrada.modo,
      escopos_pedidos: entrada.modo === "oauth_por_contato" ? entrada.escoposPedidos : [],
      escrita_delegada: entrada.modo === "oauth_por_contato" && entrada.escritaDelegada,
      retencao_apos_encerramento_horas: entrada.retencaoHoras,
      ativo: entrada.ativo,
    };
    let mudou =
      !atual ||
      atual.nome !== entrada.nome ||
      atual.endpoint !== entrada.endpoint ||
      atual.modo !== entrada.modo ||
      JSON.stringify(atual.escoposPedidos) !== JSON.stringify(colunas.escopos_pedidos) ||
      atual.escritaDelegada !== colunas.escrita_delegada ||
      atual.retencaoHoras !== entrada.retencaoHoras ||
      atual.ativo !== entrada.ativo;

    if (entrada.modo === "chave_estatica") {
      if (entrada.chave !== "") {
        if (entrada.chave !== atual?.chave) mudou = true;
        Object.assign(colunas, cifrar("chave", entrada.chave), { chave_last4: ultimos4(entrada.chave) });
      } else if (!atual?.chave) {
        throw new Recusa(`O servidor «${nome}» com \`autenticacao: "chave_estatica"\` precisa de \`chave\` (a que o sistema de fora deu). Ela entra cifrada e nunca volta.`);
      }
    } else {
      Object.assign(colunas, apagado("chave"), { chave_last4: null });
    }

    let comOHumano: ItemComOHumano[] = [];
    if (entrada.modo === "oauth_por_contato") {
      const mudouEndereco = !atual || atual.endpoint !== entrada.endpoint || atual.modo !== "oauth_por_contato" || !atual.oauth;
      let metadados: MetadadosOauth | null = mudouEndereco ? null : atual!.oauth;
      let clientId = entrada.oauthClientId || (mudouEndereco ? "" : (atual?.oauthClientId ?? ""));
      if (clientId !== (atual?.oauthClientId ?? "")) mudou = true;
      try {
        if (!metadados) {
          const d = await descobrir(entrada.endpoint);
          const { metodosDeAutenticacaoNoToken, ...resto } = d;
          metadados = { ...resto, cliente_dinamico: false, descoberto_em: new Date().toISOString(), metodos_no_token: metodosDeAutenticacaoNoToken };
        }
        if (!clientId) {
          if (!metadados.registration_endpoint) {
            // O passo de uma pessoa: registrar o aplicativo no sistema de fora.
            // Como na tela, o servidor não é gravado sem `client_id`.
            passos.push({
              ...base,
              acao: "com_o_humano",
              id,
              slug,
              comOHumano: [
                {
                  servidor: nome,
                  quem: "uma pessoa da empresa",
                  o_que: `O sistema de ${hostDoEndpoint(metadados.emissor)} não aceita registro automático de aplicativo: alguém com acesso a ele precisa registrar o aplicativo (cliente OAuth) à mão. O servidor «${nome}» NÃO foi gravado.`,
                  como:
                    `No sistema de fora, registre um aplicativo com o endereço de retorno ${urlDoCallbackMcp(id)}` +
                    (entrada.escoposPedidos.length ? ` e os escopos ${entrada.escoposPedidos.join(" ")}` : "") +
                    ". Depois chame plataforma_garantir_agente de novo com o MESMO nome e endereço, mais `oauth_client_id` (e `oauth_client_secret`, se o sistema der um). " +
                    "O endereço de retorno não muda entre as chamadas. A tela do agente (Servidores MCP) faz o mesmo cadastro.",
                },
              ],
            });
            continue;
          }
          clientId = await registrarCliente(metadados.registration_endpoint, {
            redirectUri: urlDoCallbackMcp(id),
            nomeDoCliente: `${(await marcaDaSaida(c.orgId)).nome} — ${org.display_name}`.trim(),
            escopos: entrada.escoposPedidos,
          });
          metadados = { ...metadados, cliente_dinamico: true };
        }
      } catch (err) {
        const codigo = err instanceof ErroDeOauth ? err.codigo : "descoberta_falhou";
        throw new Recusa(`O servidor «${nome}» não pôde ser cadastrado com OAuth: ${FRASE_DO_OAUTH[codigo]}. Nada foi gravado.`);
      }
      if (mudouEndereco) mudou = true;
      colunas.oauth_metadados = metadados;
      colunas.oauth_client_id = clientId;
      // Cliente do registro dinâmico é público: segredo NUNCA é gravado.
      if (metadados.cliente_dinamico) Object.assign(colunas, apagado("oauth_client_secret"));
      else if (entrada.oauthClientSecret !== "") {
        if (entrada.oauthClientSecret !== atual?.oauthClientSecret) mudou = true;
        Object.assign(colunas, cifrar("oauth_client_secret", entrada.oauthClientSecret));
      } else if (mudouEndereco) Object.assign(colunas, apagado("oauth_client_secret"));
      comOHumano = [
        {
          servidor: nome,
          quem: "cada contato, na conversa",
          o_que: "Cada contato autoriza o acesso com o login DELE no sistema de fora, no navegador. Sem isso, a IA não alcança as ferramentas deste servidor na conversa com ele.",
          como:
            "Na primeira vez que precisar, a IA manda ao contato o link de autorização (vale 10 minutos, uso único). Ninguém da implantação autoriza no lugar do contato, e o MCP não gera nem abre esse link. " +
            (entrada.retencaoHoras === 0
              ? "O acesso é revogado quando a conversa é encerrada."
              : `O acesso é revogado ${entrada.retencaoHoras} hora(s) depois de a conversa ser encerrada.`),
        },
      ];
    } else {
      Object.assign(colunas, { oauth_metadados: {}, oauth_client_id: null }, apagado("oauth_client_secret"));
    }

    // Trocou a ORIGEM dos tokens (endereço, modo ou cliente OAuth)? Os acessos
    // de contato da configuração antiga são revogados nela, antes da nova.
    const revogarAntes =
      atual?.modo === "oauth_por_contato" &&
      (entrada.modo !== "oauth_por_contato" || atual.endpoint !== entrada.endpoint || (colunas.oauth_client_id ?? null) !== atual.oauthClientId);

    if (!atual) {
      quantos += 1;
      slugsOcupados.add(slug);
    }
    passos.push({
      ...base,
      acao: atual ? (mudou ? "atualizar" : "nada") : "criar",
      id,
      slug,
      colunas,
      revogarAntes,
      ...(pedido.ferramentas !== undefined ? { toolIds: idsDasFerramentas(nome, id, pedido.ferramentas) } : {}),
      comOHumano,
    });
  }
  return { passos };
}

/**
 * As escolhas do rascunho que o plano troca: servidor (id) → a lista INTEIRA
 * dos ids dele. Só os servidores que vão existir depois de gravar e que
 * trouxeram `ferramentas`. Os apagados ficam como estão (escolhas órfãs, que
 * não montam nada, como na tela).
 */
export function ferramentasDoPlano(plano: PlanoDosServidores | null): Map<string, string[]> {
  const mapa = new Map<string, string[]>();
  for (const p of plano?.passos ?? []) {
    if (p.toolIds !== undefined && (p.acao === "criar" || p.acao === "atualizar" || p.acao === "nada")) mapa.set(p.id, p.toolIds);
  }
  return mapa;
}

export interface ServidorGarantido {
  nome: string;
  desfecho: DesfechoDoServidor;
  servidor: RetratoDoServidorMcp | null;
  acessos_revogados?: number;
}

/** Grava o plano: o cadastro do servidor vale na hora (não é versionado). */
export async function gravarServidoresDoAgente(
  c: Implantacao,
  agentId: string,
  plano: PlanoDosServidores,
): Promise<{ servidores: ServidorGarantido[]; com_o_humano: ItemComOHumano[]; mudancas: string[] }> {
  const servidores: ServidorGarantido[] = [];
  const comOHumano: ItemComOHumano[] = [];
  const mudancas: string[] = [];

  for (const p of plano.passos) {
    comOHumano.push(...p.comOHumano);
    if (p.acao === "com_o_humano") {
      servidores.push({ nome: p.nome, desfecho: "com_o_humano", servidor: null });
      continue;
    }
    if (p.acao === "nada") {
      servidores.push({ nome: p.nome, desfecho: "ja_estava", servidor: p.atual ? retratoDoServidorMcp(p.atual) : null });
      continue;
    }
    if (p.acao === "apagar") {
      const atual = p.atual!;
      const revogadas = p.revogarAntes ? await revogarAcessosDoServidor(c.admin, atual) : 0;
      const { error } = await c.admin.from("ai_agent_mcp_servers").delete().eq("organization_id", c.orgId).eq("id", atual.id);
      if (error) throw new Error(`não consegui tirar o servidor MCP «${p.nome}»: ${error.message}`);
      void audit({
        action: "agent.mcp_servidor_removido",
        actorUserId: c.autorUserId,
        organizationId: c.orgId,
        resourceType: "ai_agent",
        resourceId: agentId,
        requestId: c.requestId,
        metadata: { servidor_id: atual.id, modo: atual.modo, endpoint: hostDoEndpoint(atual.endpoint), credenciais_revogadas: revogadas, via: "mcp_plataforma" },
      });
      servidores.push({ nome: p.nome, desfecho: "apagou", servidor: null, acessos_revogados: revogadas });
      mudancas.push(`servidor MCP «${p.nome}» tirado`);
      continue;
    }

    let revogadas = 0;
    if (p.revogarAntes && p.atual) revogadas = await revogarAcessosDoServidor(c.admin, p.atual);
    const gravacao = p.atual
      ? c.admin.from("ai_agent_mcp_servers").update(p.colunas).eq("organization_id", c.orgId).eq("id", p.atual.id)
      : c.admin.from("ai_agent_mcp_servers").insert({
          ...p.colunas,
          id: p.id,
          organization_id: c.orgId,
          agent_id: agentId,
          slug: p.slug,
          created_by: c.autorUserId,
        });
    const { error } = await gravacao;
    if (error) throw new Error(`não consegui gravar o servidor MCP «${p.nome}»: ${error.message}`);

    const salvo = (await lerServidoresDoAgente(c.admin, c.orgId, agentId)).find((s) => s.id === p.id);
    if (!salvo) throw new Error(`gravei o servidor MCP «${p.nome}», mas não consegui relê-lo. Chame de novo.`);
    void audit({
      action: "agent.mcp_servidor_salvo",
      actorUserId: c.autorUserId,
      organizationId: c.orgId,
      resourceType: "ai_agent",
      resourceId: agentId,
      requestId: c.requestId,
      // FORMA, nunca credencial: o mesmo metadata da tela.
      metadata: {
        servidor_id: salvo.id,
        criado: !p.atual,
        modo: salvo.modo,
        endpoint: hostDoEndpoint(salvo.endpoint),
        escrita_delegada: salvo.escritaDelegada,
        cliente_dinamico: salvo.oauth?.cliente_dinamico ?? false,
        via: "mcp_plataforma",
      },
    });
    servidores.push({
      nome: p.nome,
      desfecho: p.atual ? "atualizou" : "criou",
      servidor: retratoDoServidorMcp(salvo),
      ...(revogadas > 0 ? { acessos_revogados: revogadas } : {}),
    });
    mudancas.push(`servidor MCP «${p.nome}»`);
  }
  return { servidores, com_o_humano: comOHumano, mudancas };
}
