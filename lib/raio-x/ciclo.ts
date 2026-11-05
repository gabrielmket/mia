/**
 * FORK MIA (.101) · O QUE O AGENDADOR FAZ COM OS RAIO-X A CADA MINUTO
 * (`app/api/v1/cron/raio-x`). Na ordem:
 *
 *  1. os PRAZOS: derrubar a conexão do diagnóstico 7 dias depois do relatório;
 *     apagar as conversas 30 dias depois; no mensal, abrir o mês novo no dia 1
 *     e apagar as mensagens do mês que fez 30 dias de relatório;
 *  2. quem está CONECTANDO: o aparelho pareou? Confere que é o número
 *     cadastrado (o termo é daquele número) e começa a leitura;
 *  3. quem está LENDO: uma rodada de leitura (`leitura.ts`);
 *  4. quem está ANALISANDO: uma rodada de análise (`analise.ts`).
 *
 * Cada raio-X anda com uma TRAVA (`mia_raio_x.trava_ate`, gravada por update
 * condicional): duas chamadas do cron não andam o mesmo raio-X juntas. Tudo
 * divide o prazo da chamada. Devolve os EFEITOS que a rota audita (rodada que
 * só andou o cursor não audita: tests/unit/cron-audita-so-quando-ha-efeito).
 *
 * O raio-X é da plataforma, não de uma empresa da MIA: não há "empresa parada"
 * a respeitar aqui (a empresa ligada é opcional e só serve para comparar).
 *
 * FORK MIA (.102): o raio-X do CLIENTE ATIVO (fonte "conversas da MIA") não
 * tem conexão: depois da autorização ele já nasce "lendo", e a rodada de
 * leitura é a da conta (`leitura-da-conta.ts`), sem o leitor. O resto (a
 * análise, o relatório, os 30 dias para apagar e o mensal) é o mesmo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { samePhone } from "@/lib/channels/phone-variants";
import type { LeitorDoRaioX } from "@/lib/channels/raio-x/leitor";
import { logger } from "@/lib/logger";

import {
  chamadaDaPlataforma,
  modeloDaAnalise,
  rodadaDeAnalise,
  transcritorDaPlataforma,
  type ChamarOModelo,
  type ModeloDaAnalise,
} from "./analise";
import { COLUNAS_DO_RAIO_X, desconectarAgora, type LinhaDoRaioX } from "./banco";
import { estadoInicial, lerEstado, rodadaDeLeitura } from "./leitura";
import { lerEstadoDaConta, rodadaDeLeituraDaConta } from "./leitura-da-conta";
import { relatorioMensalDevido, venceu } from "./prazos";

export type EfeitoDoCiclo =
  | { acao: "raio_x.conectado"; raioXId: string }
  | { acao: "raio_x.numero_diferente"; raioXId: string }
  | { acao: "raio_x.leitura_concluida"; raioXId: string; conversas: number; mensagens: number }
  | { acao: "raio_x.relatorio_gerado"; raioXId: string; relatorioId: string }
  | { acao: "raio_x.desconectado"; raioXId: string; motivo: "prazo" | "aparelho" }
  | { acao: "raio_x.conversas_apagadas"; raioXId: string; mensagens: number; conversas: number; parcial: boolean }
  | { acao: "raio_x.mes_aberto"; raioXId: string; competencia: string };

export interface ResumoDoCiclo {
  efeitos: EfeitoDoCiclo[];
  rodadas: number;
  puladas: number;
  falhas: number;
}

const TRAVA_MS = 5 * 60_000;
const DIA_MS = 86_400_000;

interface Dependencias {
  admin: SupabaseClient;
  leitor: LeitorDoRaioX | null;
  prazo: number;
  agora?: () => number;
  /** Para o teste: o modelo de IA, a chamada e o transcritor dublados. */
  modelo?: ModeloDaAnalise | null;
  chamar?: ChamarOModelo | null;
  transcritor?: ReturnType<typeof transcritorDaPlataforma>;
  /** FORK MIA (.102), para o teste: o arquivo do áudio da conta (sem ele, o storage da conta). */
  baixarDaConta?: (mensagemId: string) => Promise<{ bytes: Buffer; mime: string } | null>;
}

async function travar(admin: SupabaseClient, r: LinhaDoRaioX, agora: number): Promise<boolean> {
  const { data, error } = await admin
    .from("mia_raio_x")
    .update({ trava_ate: new Date(agora + TRAVA_MS).toISOString() })
    .eq("id", r.id)
    .eq("updated_at", r.updated_at)
    .select("id")
    .maybeSingle();
  return !error && Boolean(data);
}

async function gravar(admin: SupabaseClient, id: string, valores: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from("mia_raio_x").update({ ...valores, trava_ate: null }).eq("id", id);
  if (error) throw new Error(`raio-x: gravar o andamento (${error.code ?? "sem_codigo"})`);
}

async function linhas(consulta: PromiseLike<{ data: unknown; error: { code?: string } | null }>): Promise<LinhaDoRaioX[]> {
  const { data, error } = await consulta;
  if (error) throw new Error(`raio-x: leitura do ciclo (${error.code ?? "sem_codigo"})`);
  return (data ?? []) as LinhaDoRaioX[];
}

export async function rodarOCiclo(dep: Dependencias): Promise<ResumoDoCiclo> {
  const agora = dep.agora ?? Date.now;
  const resumo: ResumoDoCiclo = { efeitos: [], rodadas: 0, puladas: 0, falhas: 0 };
  const agoraIso = () => new Date(agora()).toISOString();
  const livre = (r: LinhaDoRaioX) => !r.trava_ate || Date.parse(r.trava_ate) <= agora();

  // ── 1. os prazos ──────────────────────────────────────────────────────────
  const aDesconectar = await linhas(
    dep.admin
      .from("mia_raio_x")
      .select(COLUNAS_DO_RAIO_X)
      .neq("situacao", "encerrado")
      .is("desconectado_em", null)
      .lte("desconectar_em", agoraIso())
      .limit(20),
  );
  for (const r of aDesconectar) {
    if (!venceu(r.desconectar_em, new Date(agora()))) continue;
    await desconectarAgora(dep.admin, r, new Date(agora()), dep.leitor);
    resumo.efeitos.push({ acao: "raio_x.desconectado", raioXId: r.id, motivo: "prazo" });
  }

  const aApagar = await linhas(
    dep.admin
      .from("mia_raio_x")
      .select(COLUNAS_DO_RAIO_X)
      .is("conversas_apagadas_em", null)
      .lte("apagar_conversas_em", agoraIso())
      .limit(20),
  );
  for (const r of aApagar) {
    const { data, error } = await dep.admin.rpc("fn_mia_raio_x_expurgar_conversas", { p_raio_x: r.id });
    if (error) {
      resumo.falhas += 1;
      continue;
    }
    const contagem = (data ?? {}) as { mensagens?: number; conversas?: number };
    resumo.efeitos.push({
      acao: "raio_x.conversas_apagadas",
      raioXId: r.id,
      mensagens: Number(contagem.mensagens) || 0,
      conversas: Number(contagem.conversas) || 0,
      parcial: false,
    });
  }

  // O mensal: o mês novo no dia 1, e as mensagens do mês que fez 30 dias de relatório.
  const mensais = await linhas(
    dep.admin
      .from("mia_raio_x")
      .select(COLUNAS_DO_RAIO_X)
      .eq("tipo", "mensal")
      .eq("situacao", "pronto")
      .is("desconectado_em", null)
      .limit(100),
  );
  for (const r of mensais) {
    if (!livre(r)) continue;
    const devido = relatorioMensalDevido(r.ultimo_relatorio_em ? new Date(r.ultimo_relatorio_em) : null, new Date(agora()));
    if (devido && (await travar(dep.admin, r, agora()))) {
      await gravar(dep.admin, r.id, {
        situacao: "lendo",
        ciclo: r.ciclo + 1,
        periodo_inicio: devido.inicio.toISOString(),
        periodo_fim: devido.fim.toISOString(),
        competencia: devido.competencia,
        leitura: estadoInicial(devido.inicio, devido.fim, "lendo"),
        leitura_concluida_em: null,
        analise: {},
      });
      resumo.efeitos.push({ acao: "raio_x.mes_aberto", raioXId: r.id, competencia: devido.competencia });
    }
    const { data: velho } = await dep.admin
      .from("mia_raio_x_relatorios")
      .select("periodo_fim")
      .eq("raio_x_id", r.id)
      .lte("created_at", new Date(agora() - 30 * DIA_MS).toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const corte = (velho as { periodo_fim?: string } | null)?.periodo_fim;
    if (corte) {
      const { data, error } = await dep.admin.rpc("fn_mia_raio_x_expurgar_conversas", { p_raio_x: r.id, p_antes_de: corte });
      const mensagens = Number((data as { mensagens?: number } | null)?.mensagens) || 0;
      if (!error && mensagens > 0) {
        resumo.efeitos.push({ acao: "raio_x.conversas_apagadas", raioXId: r.id, mensagens, conversas: 0, parcial: true });
      }
    }
  }

  // ── 2 a 4. os que estão andando ───────────────────────────────────────────
  const andando = await linhas(
    dep.admin
      .from("mia_raio_x")
      .select(COLUNAS_DO_RAIO_X)
      .in("situacao", ["conectando", "lendo", "analisando"])
      .order("updated_at", { ascending: true })
      .limit(20),
  );
  const modelo = dep.modelo !== undefined ? dep.modelo : modeloDaAnalise();
  const chamar = dep.chamar !== undefined ? dep.chamar : modelo ? chamadaDaPlataforma(modelo) : null;
  const transcritor = dep.transcritor !== undefined ? dep.transcritor : transcritorDaPlataforma();

  for (const r of andando) {
    if (dep.prazo - agora() < 20_000) break;
    if (!livre(r)) {
      resumo.puladas += 1;
      continue;
    }
    try {
      if (r.situacao === "conectando") {
        // FORK MIA (.102): o cliente ativo não conecta nada.
        if (r.fonte === "conversas_da_mia") continue;
        if (!r.sessao || !dep.leitor) continue;
        const estado = await dep.leitor.estado(r.sessao);
        if (estado.estado !== "conectado") continue;
        if (!(await travar(dep.admin, r, agora()))) {
          resumo.puladas += 1;
          continue;
        }
        resumo.rodadas += 1;
        // O termo é do número cadastrado: outro número não é lido. A comparação
        // é pelo nono dígito (`samePhone`): o WhatsApp de muito celular brasileiro
        // se identifica SEM o 9 (553198966398), e o cadastro guarda com ele.
        if (estado.numero && !samePhone(estado.numero, r.whatsapp)) {
          await dep.leitor.desconectar(r.sessao).catch(() => undefined);
          await gravar(dep.admin, r.id, { leitura: { erro: "numero_diferente" }, numero_conectado: null });
          resumo.efeitos.push({ acao: "raio_x.numero_diferente", raioXId: r.id });
          continue;
        }
        const inicio = new Date(agora() - r.periodo_dias * DIA_MS);
        await gravar(dep.admin, r.id, {
          situacao: "lendo",
          conectado_em: agoraIso(),
          numero_conectado: estado.numero,
          periodo_inicio: inicio.toISOString(),
          periodo_fim: null,
          leitura: estadoInicial(inicio, null, "sincronizando"),
          // Conectou: o link de conexão não serve mais para conectar.
          conexao_expira_em: agoraIso(),
        });
        resumo.efeitos.push({ acao: "raio_x.conectado", raioXId: r.id });
        continue;
      }

      if (r.situacao === "lendo" && r.fonte === "conversas_da_mia") {
        // FORK MIA (.102): a leitura das conversas da própria conta, sem leitor.
        if (!(await travar(dep.admin, r, agora()))) {
          resumo.puladas += 1;
          continue;
        }
        resumo.rodadas += 1;
        const rodada = await rodadaDeLeituraDaConta({ admin: dep.admin, raioX: r, prazo: dep.prazo, agora }, lerEstadoDaConta(r.leitura));
        if (rodada.concluiu) {
          await gravar(dep.admin, r.id, { leitura: rodada.estado, leitura_concluida_em: agoraIso(), situacao: "analisando" });
          resumo.efeitos.push({
            acao: "raio_x.leitura_concluida",
            raioXId: r.id,
            conversas: rodada.estado.conversas_lidas,
            mensagens: rodada.estado.mensagens_lidas,
          });
          continue;
        }
        await gravar(dep.admin, r.id, { leitura: rodada.estado });
        continue;
      }

      if (r.situacao === "lendo") {
        if (!dep.leitor || !r.sessao) continue;
        if (!(await travar(dep.admin, r, agora()))) {
          resumo.puladas += 1;
          continue;
        }
        resumo.rodadas += 1;
        const estado = lerEstado(r.leitura) ?? estadoInicial(new Date(r.periodo_inicio ?? agora() - r.periodo_dias * DIA_MS), null, "sincronizando");
        const rodada = await rodadaDeLeitura(
          { admin: dep.admin, leitor: dep.leitor, raioX: r, prazo: dep.prazo, agora },
          estado,
        );
        if (rodada.concluiu) {
          await gravar(dep.admin, r.id, {
            leitura: rodada.estado,
            leitura_concluida_em: agoraIso(),
            periodo_fim: r.periodo_fim ?? agoraIso(),
            situacao: "analisando",
          });
          resumo.efeitos.push({
            acao: "raio_x.leitura_concluida",
            raioXId: r.id,
            conversas: rodada.estado.conversas_lidas,
            mensagens: rodada.estado.mensagens_lidas,
          });
          continue;
        }
        // O dono desconectou pelo celular no meio da leitura: o que foi lido vira relatório.
        if (rodada.estado.erro) {
          const aparelho = await dep.leitor.estado(r.sessao).catch(() => null);
          if (aparelho && (aparelho.estado === "esperando_pareamento" || aparelho.estado === "ausente")) {
            await gravar(dep.admin, r.id, {
              leitura: rodada.estado,
              leitura_concluida_em: agoraIso(),
              periodo_fim: r.periodo_fim ?? agoraIso(),
              situacao: "analisando",
              desconectado_em: agoraIso(),
            });
            resumo.efeitos.push({ acao: "raio_x.desconectado", raioXId: r.id, motivo: "aparelho" });
            continue;
          }
        }
        await gravar(dep.admin, r.id, { leitura: rodada.estado });
        continue;
      }

      if (r.situacao === "analisando") {
        if (!(await travar(dep.admin, r, agora()))) {
          resumo.puladas += 1;
          continue;
        }
        resumo.rodadas += 1;
        const desfecho = await rodadaDeAnalise(
          {
            admin: dep.admin,
            leitor: dep.leitor,
            modelo,
            chamar,
            transcritor,
            prazo: dep.prazo,
            agora,
            ...(dep.baixarDaConta ? { baixarDaConta: dep.baixarDaConta } : {}),
          },
          r,
        );
        // `gerarRelatorio` já gravou a situação; aqui só solta a trava.
        await dep.admin.from("mia_raio_x").update({ trava_ate: null }).eq("id", r.id);
        if (desfecho.tipo === "relatorio") {
          resumo.efeitos.push({ acao: "raio_x.relatorio_gerado", raioXId: r.id, relatorioId: desfecho.relatorioId });
        }
      }
    } catch (erro) {
      resumo.falhas += 1;
      logger.warn("[raio-x] o ciclo de um raio-X falhou", {
        raioXId: r.id,
        detail: erro instanceof Error ? erro.message : "erro",
      });
      await dep.admin.from("mia_raio_x").update({ trava_ate: null }).eq("id", r.id);
    }
  }
  return resumo;
}
