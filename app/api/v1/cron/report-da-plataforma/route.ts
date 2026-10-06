/**
 * report-da-plataforma — o vigia que fala no grupo INTERNO.
 *
 * Quatro perguntas, uma rodada (e uma quinta, a zero, que não fala no grupo):
 *
 *   0. O backup diário do banco está em dia? (FORK MIA .62 — avisa os
 *      administradores da plataforma por incidente e push, não pelo grupo)
 *   1. O crédito de IA está acabando? (o que derruba TODOS os clientes de uma vez)
 *   2. Algum número caiu? (o que derruba um — e o de avisos derruba todos)
 *   3. O schema veio junto com o código no último deploy?
 *   4. É hora do resumo do dia?
 *
 * A 3 é a única que fala do SISTEMA e não de um cliente, e por isso vem antes
 * do resumo: com o schema atrasado, tudo o que o resumo conta está medido sobre
 * um banco que não é o que o código espera.
 *
 * ─── Por que um cron, e não um gancho em cada lugar ────────────────────────
 *
 * Porque as três condições são ESTADOS, não eventos. "O saldo está abaixo de
 * 20 dólares" não acontece num instante que dê para instrumentar: ele passa a
 * ser verdade e continua sendo. Um gancho no momento da queda erraria o caso
 * mais comum — a instalação que já estava assim quando ninguém olhou.
 *
 * ─── A trava anti-ruído ────────────────────────────────────────────────────
 *
 * Este cron roda de minuto em minuto. Cada aviso tem chave e janela própria
 * (`lib/avisos/report-da-plataforma.ts`), então a condição que dura dois dias
 * rende dois recados, não 2.880. Sem isso, o grupo é ignorado em uma semana — e
 * aí o aviso que importa chega junto com o lixo.
 *
 * Auth: Bearer INTERNAL_CRON_SECRET|INTERNAL_SECRET (fail-closed), como os demais.
 *
 * NOTA DE DEPLOY: o agendamento vive no serviço `scheduler` do
 * `docker-compose.prod.yml` — não há `vercel.json` neste repo (self-host).
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { avisoDoCreditoDeIa } from "@/lib/ai/custo/aviso-do-credito";
import { saldoDaPlataformaParaOVigia } from "@/lib/ai/custo/saldo-da-plataforma";
import { grupoDeReport, reportar } from "@/lib/avisos/report-da-plataforma";
import { vigiarBackup } from "@/lib/backup/aviso-do-backup";
import { avaliarBackup, leituraDoRpc } from "@/lib/backup/estado-do-backup";
import { alertaDoSchema, CARIMBO_DO_SCHEMA, TABELA_DO_CARIMBO } from "@/lib/schema/carimbo";
import { STATUS_SAUDAVEL } from "@/lib/channels/health";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  excluirDemonstracao,
  idsDasEmpresasDeDemonstracao,
  SEM_DEMONSTRACAO,
} from "@/lib/demonstracao/fora-das-metricas";

export const dynamic = "force-dynamic";

/** Uma vez por dia enquanto a condição durar. */
const UM_DIA = 24;

/** A hora (no fuso da instalação) em que o resumo do dia sai. */
const HORA_DO_RESUMO = 8;

function dinheiro(usd: number): string {
  return usd.toLocaleString("pt-BR", { style: "currency", currency: "USD" });
}

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const admin = createAdminClient();

  // ── 0. O BACKUP do banco (FORK MIA .62) ──────────────────────────────────
  //
  // Vem ANTES da saída "sem grupo" porque não fala no grupo: o aviso vai aos
  // administradores da plataforma, pelo incidente e pelo push
  // (`lib/backup/aviso-do-backup.ts`), com trava de um por dia. Um backup
  // parado não pode ficar calado numa instalação que não configurou o report.
  // A leitura é pela função da 9006; sem ela, o estado é `desconhecido` e o
  // vigia não avisa nem fecha nada.
  const backup = await (async () => {
    try {
      const estado = avaliarBackup(leituraDoRpc(await admin.rpc("fn_mia_estado_do_backup")), new Date());
      const vigia = await vigiarBackup(admin, estado);
      return { estado: estado.estado, ...vigia };
    } catch {
      return { estado: "desconhecido" as const, avisados: [], resolvidos: [] };
    }
  })();

  // Sem grupo escolhido não há o que fazer — e sair cedo evita gastar as
  // consultas de saldo (que varrem `llm_calls`) numa instalação que não usa
  // este recurso.
  const grupo = await grupoDeReport(admin);
  if (!grupo) return ok({ enviados: 0, motivo: "sem_grupo_de_report", backup }, { requestId });

  const enviados: string[] = [];

  // ── 1. O crédito de IA ────────────────────────────────────────────────────
  //
  // `saldoUsd` nulo significa "nunca registraram uma leitura", e não "acabou".
  // Avisar nesse caso faria o grupo receber um alarme falso por dia para sempre
  // numa instalação que simplesmente não usa o livro-caixa.
  //
  // O saldo é relido no máximo a cada 15 minutos (`saldoDaPlataformaParaOVigia`):
  // este cron roda de minuto em minuto, e a leitura do consumo agora cobre o
  // período inteiro, em páginas. E a decisão do que dizer mora em
  // `avisoDoCreditoDeIa`: além do "acabando", ela NÃO cala quando o consumo
  // veio parcial e o saldo calculado é só um teto.
  const saldo = await saldoDaPlataformaParaOVigia(admin);
  const avisoDoCredito = avisoDoCreditoDeIa(saldo, grupo.limiteSaldoUsd);
  if (avisoDoCredito) {
    const saiu = await reportar(admin, {
      chave: avisoDoCredito.chave,
      horas: UM_DIA,
      texto: avisoDoCredito.texto,
      detalhe: avisoDoCredito.detalhe,
    });
    if (saiu) enviados.push(avisoDoCredito.chave);
  }

  // ── 2. Os números que caíram ──────────────────────────────────────────────
  //
  // Chave por SESSÃO: dois números caídos rendem dois recados (são dois
  // problemas), mas o mesmo número caído há três dias rende um por dia.
  const { data: sessoes } = await admin
    .from("channel_sessions")
    .select("id, organization_id, display_name, phone_number, status, e_numero_de_avisos")
    .is("archived_at", null)
    .neq("status", STATUS_SAUDAVEL)
    .limit(50);

  for (const s of sessoes ?? []) {
    const linha = s as {
      id: string;
      organization_id: string;
      display_name: string | null;
      phone_number: string | null;
      status: string | null;
      e_numero_de_avisos: boolean | null;
    };

    // STARTING é o estado normal de todo boot. Avisar nele faria o grupo receber
    // recado a cada reinício do contêiner — o caminho mais curto para alguém
    // criar o hábito de ignorar.
    if (linha.status === "STARTING") continue;

    const { data: org } = await admin
      .from("organizations")
      .select("display_name")
      .eq("id", linha.organization_id)
      .maybeSingle();

    /**
     * O número de AVISOS caído é outro tamanho de problema, e o texto diz isso.
     *
     * Ele é ponto único de falha assumido: enquanto estiver fora, NENHUM cliente
     * recebe aviso de bastão. Tratá-lo como "mais um canal caído" esconderia,
     * numa lista, o único que para a plataforma inteira.
     */
    const ehONumeroDeAvisos = linha.e_numero_de_avisos === true;
    const apelido = linha.display_name ?? linha.phone_number ?? linha.id;
    const nomeDaOrg = (org as { display_name?: string } | null)?.display_name ?? "—";

    const saiu = await reportar(admin, {
      chave: `canal_caiu:${linha.id}`,
      horas: UM_DIA,
      texto: ehONumeroDeAvisos
        ? `🚨 *O NÚMERO DE AVISOS caiu*\n\n*Número:* ${apelido}\n*Estado:* ${linha.status}\n\n` +
          `Enquanto ele estiver fora, NENHUM cliente recebe aviso de lead qualificado no grupo.`
        : `⚠️ *Número fora do ar*\n\n*Cliente:* ${nomeDaOrg}\n*Número:* ${apelido}\n*Estado:* ${linha.status}`,
      detalhe: { status: linha.status, organization_id: linha.organization_id },
    });
    if (saiu) enviados.push(`canal_caiu:${linha.id}`);
  }

  // ── 3. O SCHEMA não veio junto com o código ───────────────────────────────
  //
  // `easypanel/bootstrap.sh` aplica o baseline com `|| true` num banco que já
  // existe — que é TODO deploy depois do primeiro. Se um comando falha, ele
  // escreve `AVISO: ... (o app sobe mesmo assim)` e segue. O produto sobe
  // saudável, com o código novo e o schema de ontem, e as duas coisas são
  // verdade. O único registro é o stdout de um contêiner efêmero, e a agregação
  // de logs da VPS está desligada (item E4).
  //
  // As migrations 0268/0269 puseram a resposta no banco e em `/api/v1/health`;
  // a 0269 acrescentou o contador de erros. O que faltava era ALGUÉM CONTAR:
  // um campo que só existe na rota depende de alguém lembrar de olhar, e
  // ninguém olha saúde depois de um deploy que subiu verde.
  //
  // ⚠️ É o único alerta daqui que fala do SISTEMA e não de um cliente, e é por
  // isso que ele vem antes do resumo: quando o schema está atrasado, tudo o que
  // o resumo conta está medido sobre um banco que não é o que o código espera.
  {
    const { data: carimbo } = await admin
      .from(TABELA_DO_CARIMBO)
      .select("migration_mais_nova, erros_inesperados, erros_amostra")
      .eq("id", 1)
      .maybeSingle();

    // A REGRA mora em `lib/schema/carimbo.ts` e é pura: quatro estados, três
    // deles "não avisar" — e cada um pelo motivo certo. Aqui fica só o I/O.
    const alerta = carimbo
      ? alertaDoSchema(
          carimbo as {
            migration_mais_nova: string | null;
            erros_inesperados: number | null;
            erros_amostra: string | null;
          },
        )
      : null;

    if (alerta) {
      const saiu = await reportar(admin, {
        chave: alerta.chave,
        horas: UM_DIA,
        texto:
          `🧱 *O schema não está em dia*\n\n${alerta.corpo}\n\n` +
          `Detalhe em Admin › Painel › Estado do schema.`,
        detalhe: { esperado: CARIMBO_DO_SCHEMA },
      });
      if (saiu) enviados.push(alerta.chave);
    }
  }

  // ── 4. O resumo do dia ────────────────────────────────────────────────────
  //
  // Não é alarme: é o "está tudo de pé" que faz o grupo continuar sendo lido
  // nos dias em que nada quebra — e que denuncia, por ausência, o dia em que o
  // cron parar de rodar.
  const agora = new Date();
  /**
   * A hora em São Paulo, sem `Intl`.
   *
   * `Intl.DateTimeFormat("pt-BR", …)` seria o caminho óbvio e é proibido aqui
   * com razão: o guarda `i18n-a-data-segue-o-idioma` existe para impedir data
   * com idioma fixo, e ele não tem como distinguir "data que o usuário lê" de
   * "hora que o cron usa para decidir". Fixar "en-US" para escapar do guarda
   * seria driblá-lo, não respeitá-lo.
   *
   * O Brasil não tem horário de verão desde 2019, então UTC-3 é constante. Se
   * isso voltar a mudar, é ESTA linha que precisa mudar junto — e é por isso
   * que o número aparece uma vez só, com nome.
   */
  const UTC_MENOS_TRES = 3;
  const horaLocal = (agora.getUTCHours() - UTC_MENOS_TRES + 24) % 24;

  // Cliente modelo (9010): a empresa de demonstração fica fora do resumo — os
  // dados dela são inventados. Sem conseguir saber quem excluir, o resumo não
  // sai hoje (um número inflado com a demonstração seria pior que nenhum).
  let demonstracao: string[] | null = null;
  if (grupo.resumoDiario && horaLocal === HORA_DO_RESUMO) {
    demonstracao = await idsDasEmpresasDeDemonstracao(admin).catch(() => null);
  }

  if (grupo.resumoDiario && horaLocal === HORA_DO_RESUMO && demonstracao) {
    const ontem = new Date(agora.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const [{ count: clientes }, { count: conversas }, { count: bastoes }, { count: caidos }] =
      await Promise.all([
        admin
          .from("organizations")
          .select("id", { count: "exact", head: true })
          .is("redacted_at", null)
          .is("suspended_at", null)
          .not(...SEM_DEMONSTRACAO),
        excluirDemonstracao(
          admin
            .from("conversations")
            .select("id", { count: "exact", head: true })
            .gte("last_message_at", ontem),
          demonstracao,
        ),
        excluirDemonstracao(
          admin
            .from("agent_inbox_items")
            .select("id", { count: "exact", head: true })
            .eq("kind", "handoff")
            .gte("created_at", ontem),
          demonstracao,
        ),
        admin
          .from("channel_sessions")
          .select("id", { count: "exact", head: true })
          .is("archived_at", null)
          .neq("status", STATUS_SAUDAVEL),
      ]);

    const linhaDoSaldo =
      saldo.saldoUsd === null
        ? "*Crédito de IA:* sem leitura registrada"
        : `*Crédito de IA:* ${dinheiro(saldo.saldoUsd)}` +
          // O consumo veio parcial: o número é um teto, e o resumo não o dá por certo.
          (saldo.consumoParcial ? " (conta incompleta: o saldo de verdade é menor)" : "");

    const saiu = await reportar(admin, {
      chave: "resumo_diario",
      horas: 20, // menos que 24: a rodada da hora cheia não pode pular um dia por 1 minuto
      texto:
        `📊 *Resumo da plataforma*\n\n` +
        `*Clientes ativos:* ${clientes ?? 0}\n` +
        `*Conversas nas últimas 24h:* ${conversas ?? 0}\n` +
        `*Bastões passados:* ${bastoes ?? 0}\n` +
        `*Números fora do ar:* ${caidos ?? 0}\n` +
        linhaDoSaldo,
      detalhe: { clientes, conversas, bastoes, caidos },
    });
    if (saiu) enviados.push("resumo_diario");
  }

  return ok({ enviados: enviados.length, chaves: enviados, backup }, { requestId });
}

export const GET = handle;
export const POST = handle;
