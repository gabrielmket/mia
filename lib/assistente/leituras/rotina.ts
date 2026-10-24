/**
 * FORK MIA (.88) — "COMO ESTÁ MINHA ROTINA HOJE?": tarefas, agenda, conversas e
 * números caídos, das MESMAS tabelas e com os MESMOS cortes das telas.
 *
 *   tarefas    `crm_tasks` como a tela de Tarefas: abertas (`pending` e
 *              `in_progress`), "de hoje" pelo prazo no dia da empresa, atrasadas
 *              pelo prazo vencido.
 *   agenda     `calendar_appointments` do dia, sem os cancelados, como a Agenda.
 *   conversas  "com você": a aba Minhas do Inbox (atribuídas a mim e não
 *              fechadas); "esperando resposta": a última mensagem é do cliente;
 *              "na fila": a aba Fila (`comando_da_conversa`), só para quem vê a
 *              equipe.
 *   números    `channel_sessions` fora de `WORKING`, sem os desativados, só para
 *              o administrador (é ele quem conecta).
 *
 * Usada pelo turno (cliente da sessão) e pelo resumo da manhã (cliente de
 * serviço com o escopo da pessoa) — ver `comum.ts`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { idsDosCanaisDesativados } from "@/lib/channels/desativado";
import { orgTemAutomatico } from "@/lib/ai/agents/org-tem-automatico";
import { comandosDaFila } from "@/lib/inbox/comando-da-conversa";
import { CONVERSATION_TERMINAL_STATUSES } from "@/lib/schemas/messaging";
import { rotuloLocal } from "@/lib/tempo/agora";

import { janelaDoDia } from "../config";
import { horasEntre, nomeDaPessoa, nomesDosContatos, type Escopo, type PessoaDaEquipe } from "./comum";

export interface ItemDeTarefa {
  id: string;
  titulo: string;
  prazo: string | null;
  prazo_rotulo: string | null;
  atrasada: boolean;
  responsavel: string | null;
}

export interface ItemDaAgenda {
  id: string;
  inicio: string;
  quando: string;
  titulo: string;
  contato: string | null;
  contact_id: string | null;
  responsavel: string | null;
}

export interface ConversaEsperando {
  conversation_id: string;
  contact_id: string;
  contato: string;
  esperando_desde: string;
  horas: number;
  responsavel: string | null;
}

export interface RotinaDoDia {
  dia: string;
  escopo: Escopo["tipo"];
  tarefas: {
    de_hoje: number;
    atrasadas: number;
    itens: ItemDeTarefa[];
    /** Só no escopo da equipe: quem tem mais atrasadas. */
    atrasadas_por_pessoa: Array<{ user_id: string; nome: string; atrasadas: number }> | null;
  };
  agenda: { compromissos: number; itens: ItemDaAgenda[] };
  conversas: {
    com_voce: number;
    esperando_resposta: number;
    esperando_mais_de_1h: number;
    /** Só no escopo da equipe: a aba Fila. */
    na_fila: number | null;
    /** Só no escopo da equipe: abertas sem ninguém da equipe responsável. */
    sem_dono: number | null;
    mais_antigas: ConversaEsperando[];
  };
  /** Só para o administrador: os números fora do ar. */
  numeros_desconectados: Array<{ id: string; nome: string; desde: string | null }> | null;
  contatos: string[];
  fontes: string[];
}

const TAREFAS_ABERTAS = ["pending", "in_progress"];

export async function lerRotinaDoDia(
  db: SupabaseClient,
  entrada: {
    organizationId: string;
    escopo: Escopo;
    fuso: string;
    agora: Date;
    equipe: readonly PessoaDaEquipe[];
    /** O administrador vê os números caídos. */
    veNumeros: boolean;
  },
): Promise<RotinaDoDia> {
  const { organizationId: org, escopo, agora, fuso } = entrada;
  const { inicio, fim, dia } = janelaDoDia(agora, fuso);
  const proprio = escopo.tipo === "proprio";
  const fontes = new Set<string>();

  // ── tarefas ──
  let consultaTarefas = db
    .from("crm_tasks")
    .select("id, title, due_date, status, assigned_to")
    .eq("organization_id", org)
    .in("status", TAREFAS_ABERTAS)
    .lt("due_date", fim.toISOString())
    .order("due_date", { ascending: true })
    .limit(500);
  if (proprio) consultaTarefas = consultaTarefas.eq("assigned_to", escopo.userId);
  const { data: tarefasBrutas } = await consultaTarefas;
  fontes.add("Tarefas");
  const tarefas = (tarefasBrutas ?? []) as Array<{
    id: string;
    title: string;
    due_date: string | null;
    assigned_to: string | null;
  }>;
  const atrasadas = tarefas.filter((t) => t.due_date !== null && new Date(t.due_date) < agora);
  const deHoje = tarefas.filter((t) => t.due_date !== null && new Date(t.due_date) >= inicio);
  const porPessoa = new Map<string, number>();
  for (const t of atrasadas) if (t.assigned_to) porPessoa.set(t.assigned_to, (porPessoa.get(t.assigned_to) ?? 0) + 1);
  const itensDeTarefa: ItemDeTarefa[] = [...atrasadas, ...deHoje.filter((t) => !atrasadas.includes(t))]
    .slice(0, 8)
    .map((t) => ({
      id: t.id,
      titulo: t.title,
      prazo: t.due_date,
      prazo_rotulo: t.due_date ? rotuloLocal(new Date(t.due_date), fuso) : null,
      atrasada: t.due_date !== null && new Date(t.due_date) < agora,
      responsavel: proprio ? null : nomeDaPessoa(entrada.equipe, t.assigned_to),
    }));

  // ── agenda ──
  let consultaAgenda = db
    .from("calendar_appointments")
    .select("id, title, starts_at, status, owner_user_id, contact_id")
    .eq("organization_id", org)
    .gte("starts_at", inicio.toISOString())
    .lt("starts_at", fim.toISOString())
    .neq("status", "cancelled")
    .order("starts_at", { ascending: true })
    .limit(200);
  if (proprio) consultaAgenda = consultaAgenda.eq("owner_user_id", escopo.userId);
  const { data: agendaBruta } = await consultaAgenda;
  fontes.add("Agenda");
  const compromissos = (agendaBruta ?? []) as Array<{
    id: string;
    title: string;
    starts_at: string;
    owner_user_id: string | null;
    contact_id: string | null;
  }>;

  // ── conversas ──
  const terminais = `(${CONVERSATION_TERMINAL_STATUSES.join(",")})`;
  const desativados = await idsDosCanaisDesativados(db, org);
  // O canal desativado nunca entra no Inbox: o mesmo corte da lista e do badge.
  const foraDosDesativados = desativados.length > 0 ? `(${desativados.join(",")})` : null;

  let consultaComVoce = db
    .from("conversations")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", org)
    .eq("assigned_to_user_id", escopo.userId)
    .not("status", "in", terminais);
  if (foraDosDesativados) consultaComVoce = consultaComVoce.not("channel_session_id", "in", foraDosDesativados);
  const { count: comVoce } = await consultaComVoce;

  // As colunas como `string`, e não como literal: com o literal, o analisador de
  // `select` do postgrest-js estoura a inferência de tipo nos `.not()` seguintes.
  const colunasAbertas: string = "id, contact_id, assigned_to_user_id, awaiting_since, last_inbound_at, last_outbound_at";
  let consultaAbertas = db
    .from("conversations")
    .select(colunasAbertas)
    .eq("organization_id", org)
    .eq("is_group", false)
    .not("status", "in", terminais)
    .not("last_inbound_at", "is", null);
  if (foraDosDesativados) consultaAbertas = consultaAbertas.not("channel_session_id", "in", foraDosDesativados);
  if (proprio) consultaAbertas = consultaAbertas.eq("assigned_to_user_id", escopo.userId);
  const { data: abertasBrutas } = await consultaAbertas
    .order("awaiting_since", { ascending: true, nullsFirst: false })
    .limit(500);
  fontes.add("Caixa de entrada");
  const abertas = (abertasBrutas ?? []) as Array<{
    id: string;
    contact_id: string;
    assigned_to_user_id: string | null;
    awaiting_since: string | null;
    last_inbound_at: string | null;
    last_outbound_at: string | null;
  }>;
  const esperando = abertas.filter(
    (c) =>
      c.last_inbound_at !== null &&
      (c.last_outbound_at === null || new Date(c.last_inbound_at) > new Date(c.last_outbound_at)),
  );
  const desdeDe = (c: (typeof esperando)[number]) => c.awaiting_since ?? c.last_inbound_at ?? agora.toISOString();
  const maisDe1h = esperando.filter((c) => horasEntre(desdeDe(c), agora) >= 1);

  let naFila: number | null = null;
  let semDono: number | null = null;
  if (!proprio) {
    const automatico = await orgTemAutomatico(db, org);
    let consultaFila = db
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org)
      .in("comando_da_conversa", comandosDaFila(automatico));
    if (foraDosDesativados) consultaFila = consultaFila.not("channel_session_id", "in", foraDosDesativados);
    const { count } = await consultaFila;
    naFila = count ?? 0;
    semDono = abertas.filter((c) => c.assigned_to_user_id === null).length;
  }

  const maisAntigasBrutas = [...esperando].sort((a, b) => desdeDe(a).localeCompare(desdeDe(b))).slice(0, 5);

  // ── números caídos (só o administrador) ──
  let numeros: RotinaDoDia["numeros_desconectados"] = null;
  if (entrada.veNumeros) {
    const { data: sessoes } = await db
      .from("channel_sessions")
      .select("id, display_name, status, last_status_change_at")
      .eq("organization_id", org)
      .neq("status", "WORKING")
      .limit(20);
    fontes.add("Conexões");
    numeros = ((sessoes ?? []) as Array<{
      id: string;
      display_name: string | null;
      last_status_change_at: string | null;
    }>)
      .filter((s) => !desativados.includes(s.id))
      .map((s) => ({
        id: s.id,
        nome: (s.display_name ?? "").trim() || "Número sem nome",
        desde: s.last_status_change_at,
      }));
  }

  const nomes = await nomesDosContatos(db, org, [
    ...compromissos.map((c) => c.contact_id),
    ...maisAntigasBrutas.map((c) => c.contact_id),
  ]);

  return {
    dia,
    escopo: escopo.tipo,
    tarefas: {
      de_hoje: deHoje.length,
      atrasadas: atrasadas.length,
      itens: itensDeTarefa,
      atrasadas_por_pessoa: proprio
        ? null
        : [...porPessoa.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([user_id, n]) => ({ user_id, nome: nomeDaPessoa(entrada.equipe, user_id) ?? "", atrasadas: n })),
    },
    agenda: {
      compromissos: compromissos.length,
      itens: compromissos.slice(0, 8).map((c) => ({
        id: c.id,
        inicio: c.starts_at,
        quando: rotuloLocal(new Date(c.starts_at), fuso),
        titulo: c.title,
        contato: c.contact_id ? (nomes.get(c.contact_id) ?? null) : null,
        contact_id: c.contact_id,
        responsavel: proprio ? null : nomeDaPessoa(entrada.equipe, c.owner_user_id),
      })),
    },
    conversas: {
      com_voce: comVoce ?? 0,
      esperando_resposta: esperando.length,
      esperando_mais_de_1h: maisDe1h.length,
      na_fila: naFila,
      sem_dono: semDono,
      mais_antigas: maisAntigasBrutas.map((c) => ({
        conversation_id: c.id,
        contact_id: c.contact_id,
        contato: nomes.get(c.contact_id) ?? "Contato sem nome",
        esperando_desde: desdeDe(c),
        horas: horasEntre(desdeDe(c), agora),
        responsavel: proprio ? null : nomeDaPessoa(entrada.equipe, c.assigned_to_user_id),
      })),
    },
    numeros_desconectados: numeros,
    contatos: [...nomes.keys()],
    fontes: [...fontes],
  };
}
