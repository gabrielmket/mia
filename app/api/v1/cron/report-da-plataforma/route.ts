/**
 * report-da-plataforma — o vigia que fala no grupo INTERNO.
 *
 * Três perguntas, uma rodada:
 *
 *   1. O crédito de IA está acabando? (o que derruba TODOS os clientes de uma vez)
 *   2. Algum número caiu? (o que derruba um — e o de avisos derruba todos)
 *   3. É hora do resumo do dia?
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
import { saldoDaPlataforma } from "@/lib/ai/custo/saldo-da-plataforma";
import { grupoDeReport, reportar } from "@/lib/avisos/report-da-plataforma";
import { STATUS_SAUDAVEL } from "@/lib/channels/health";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

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

  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const accepted = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (accepted.length === 0 || !provided || !accepted.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const admin = createAdminClient();

  // Sem grupo escolhido não há o que fazer — e sair cedo evita gastar as
  // consultas de saldo (que varrem `llm_calls`) numa instalação que não usa
  // este recurso.
  const grupo = await grupoDeReport(admin);
  if (!grupo) return ok({ enviados: 0, motivo: "sem_grupo_de_report" }, { requestId });

  const enviados: string[] = [];

  // ── 1. O crédito de IA ────────────────────────────────────────────────────
  //
  // `saldoUsd` nulo significa "nunca registraram uma leitura", e não "acabou".
  // Avisar nesse caso faria o grupo receber um alarme falso por dia para sempre
  // numa instalação que simplesmente não usa o livro-caixa.
  const saldo = await saldoDaPlataforma(admin);
  if (saldo.saldoUsd !== null && saldo.saldoUsd <= grupo.limiteSaldoUsd) {
    const dias =
      saldo.diasRestantes === null
        ? ""
        : `\n*Dura mais ou menos:* ${Math.max(0, Math.floor(saldo.diasRestantes))} dia(s)`;
    const saiu = await reportar(admin, {
      chave: "saldo_baixo",
      horas: UM_DIA,
      texto:
        `⚠️ *Crédito de IA acabando*\n\n` +
        `*Saldo:* ${dinheiro(saldo.saldoUsd)}` +
        `\n*Limite do aviso:* ${dinheiro(grupo.limiteSaldoUsd)}${dias}\n\n` +
        `Quando o crédito acaba, a chave continua válida e a chamada volta recusada: ` +
        `o sintoma chega como "a IA parou de responder", em todos os clientes ao mesmo tempo.`,
      detalhe: { saldo_usd: saldo.saldoUsd },
    });
    if (saiu) enviados.push("saldo_baixo");
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

  // ── 3. O resumo do dia ────────────────────────────────────────────────────
  //
  // Não é alarme: é o "está tudo de pé" que faz o grupo continuar sendo lido
  // nos dias em que nada quebra — e que denuncia, por ausência, o dia em que o
  // cron parar de rodar.
  const agora = new Date();
  const horaLocal = Number(
    new Intl.DateTimeFormat("pt-BR", {
      hour: "numeric",
      hour12: false,
      timeZone: "America/Sao_Paulo",
    }).format(agora),
  );

  if (grupo.resumoDiario && horaLocal === HORA_DO_RESUMO) {
    const ontem = new Date(agora.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const [{ count: clientes }, { count: conversas }, { count: bastoes }, { count: caidos }] =
      await Promise.all([
        admin
          .from("organizations")
          .select("id", { count: "exact", head: true })
          .is("redacted_at", null)
          .is("suspended_at", null),
        admin
          .from("conversations")
          .select("id", { count: "exact", head: true })
          .gte("last_message_at", ontem),
        admin
          .from("agent_inbox_items")
          .select("id", { count: "exact", head: true })
          .eq("kind", "handoff")
          .gte("created_at", ontem),
        admin
          .from("channel_sessions")
          .select("id", { count: "exact", head: true })
          .is("archived_at", null)
          .neq("status", STATUS_SAUDAVEL),
      ]);

    const linhaDoSaldo =
      saldo.saldoUsd === null
        ? "*Crédito de IA:* sem leitura registrada"
        : `*Crédito de IA:* ${dinheiro(saldo.saldoUsd)}`;

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

  return ok({ enviados: enviados.length, chaves: enviados }, { requestId });
}

export const GET = handle;
export const POST = handle;
