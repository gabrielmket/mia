/**
 * FORK MIA — GARANTIR os PLANOS DE TAREFA de um cliente (upstream 1.77, #1752).
 *
 * ── O que é ───────────────────────────────────────────────────────────────
 *
 * Um plano é uma sequência de tarefas salva uma vez ("proposta enviada → ligar
 * em 2 dias → mandar o caso de sucesso em 5 → cobrar em 10") e aplicada a cada
 * negócio pela ação de automação `apply_task_plan`, que cria todas de uma vez,
 * na ordem, e uma vez só por negócio. Nunca fala com o cliente.
 *
 * ── O caminho da tela que isto espelha ────────────────────────────────────
 *
 *   `PATCH /api/v1/settings/task-plans` (Tarefas › Planos): a lista INTEIRA de
 *   planos, conferida por `planosSchema` (`lib/tarefas/plano.ts`, a MESMA régua
 *   que a leitura do motor aplica), gravada em `organizations.settings.task_plans`
 *   com a mescla que preserva as outras chaves, e a auditoria
 *   `task_plans.settings_updated`.
 *
 * ── O que é diferente da tela, e por quê ──────────────────────────────────
 *
 * 1. GARANTIR em vez de regravar a lista: o pedido traz os planos que quer
 *    criar ou ajustar, e os que ele não cita ficam. A chave é o `id` do plano
 *    (é ele que a regra de automação guarda em `plano_id`) ou, sem `id`, o
 *    nome. O `id` de um plano que existe NUNCA muda: trocá-lo deixaria toda
 *    regra que o aplica parando em `plano_nao_encontrado`.
 * 2. Os passos de um plano citado são a lista COMPLETA dele, na ordem.
 * 3. O responsável de cada passo chega como e-mail (ou id) de quem já é da
 *    equipe, e vira `{ usuario_id }`: na tela ele vem de um seletor que só
 *    mostra a equipe; aqui o cliente é o `service_role`, e um id de fora
 *    entraria no jsonb sem erro.
 * 4. A gravação vai por `mudarSettingsDaOrganizacao`, que não pisa em quem
 *    gravou outra chave de `settings` no meio.
 */
import { audit } from "@/lib/audit";
import { Recusa } from "@/lib/mcp-plataforma/recusa";
import { lePlanosDoSettings, planosSchema, type PlanoDeTarefas } from "@/lib/tarefas/plano";
import type { PrioridadeDaTarefa } from "@/lib/tarefas/tipos";

import { chaveDoNome, mesmoConteudo, mudarSettingsDaOrganizacao, type Desfecho, type Implantacao } from "./base";
import { acharMembro, lerMembros, type Membro } from "./equipe";

/** O teto da tela (`planosSchema`): 50 planos por empresa, 30 passos por plano. */
export const TETO_DE_PLANOS = 50;
export const TETO_DE_PASSOS = 30;

export interface PassoPedido {
  titulo: string;
  descricao?: string | null;
  /** Dias entre a aplicação do plano e o prazo da tarefa. */
  vence_em_dias: number;
  prioridade?: PrioridadeDaTarefa;
  /** "dono_do_lead" (o padrão) ou o e-mail (ou id) de uma pessoa da equipe. */
  responsavel?: string;
}

export interface PlanoPedido {
  /** O id de um plano que existe (o que a automação guarda em `plano_id`). Sem ele, o plano é achado pelo nome. */
  id?: string;
  nome: string;
  descricao?: string | null;
  passos: PassoPedido[];
}

export interface PlanoGarantido {
  id: string;
  nome: string;
  passos: number;
  desfecho: Desfecho;
}

/** Um id legível e estável a partir do nome, sem repetir os que existem. */
function idDoNome(nome: string, usados: Set<string>): string {
  const base =
    "plano-" +
    (chaveDoNome(nome)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "sem-nome");
  let id = base;
  for (let n = 2; usados.has(id); n += 1) id = `${base}-${n}`;
  return id;
}

/** Os planos como estão gravados, na forma de `planosSchema` (o que o motor lê). */
export function planosGravados(settings: Record<string, unknown>): PlanoDeTarefas[] {
  return lePlanosDoSettings(settings);
}

function responsavelDoPasso(
  ref: string | undefined,
  membros: () => Membro[],
  onde: string,
): "dono_do_lead" | { usuario_id: string } {
  if (ref === undefined || ref.trim() === "" || chaveDoNome(ref) === "dono_do_lead") return "dono_do_lead";
  try {
    return { usuario_id: acharMembro(membros(), ref).user_id };
  } catch (err) {
    if (err instanceof Recusa) throw new Recusa(`${onde}.responsavel: ${err.message}`);
    throw err;
  }
}

export async function garantirPlanosDeTarefa(
  c: Implantacao,
  pedidos: PlanoPedido[],
): Promise<{ planos: PlanoGarantido[]; total_na_empresa: number; avisos: string[] }> {
  const avisos: string[] = [];
  const precisaDaEquipe = pedidos.some((p) => p.passos.some((s) => s.responsavel !== undefined && chaveDoNome(s.responsavel) !== "dono_do_lead"));
  const equipe = precisaDaEquipe ? await lerMembros(c.admin, c.orgId) : [];

  let resultado: PlanoGarantido[] = [];
  let total = 0;
  let gravados: PlanoDeTarefas[] = [];
  let descartados = 0;

  const { mudou } = await mudarSettingsDaOrganizacao(c.admin, c.orgId, (settings) => {
    const atuais = planosGravados(settings);
    // Plano torto (gravado à mão) não é lido pelo motor nem oferecido pela tela, e
    // sai no próximo salvamento: o mesmo desfecho do PATCH da tela.
    descartados = Array.isArray(settings.task_plans) ? settings.task_plans.length - atuais.length : 0;
    const lista = atuais.map((p) => ({ ...p }));
    const usados = new Set(lista.map((p) => p.id));
    const vistosNoPedido = new Set<string>();
    resultado = [];

    for (const [i, pedido] of pedidos.entries()) {
      const nome = pedido.nome.trim();
      let existente: PlanoDeTarefas | undefined;
      if (pedido.id !== undefined) {
        existente = lista.find((p) => p.id === pedido.id);
        if (!existente) {
          throw new Recusa(
            `planos[${i}].id: não existe plano com o id «${pedido.id}» nesta organização. ` +
              (lista.length > 0 ? `Os planos são: ${lista.map((p) => `«${p.id}» (${p.nome})`).join(", ")}. ` : "") +
              "Para criar um plano novo, mande só o `nome`: o id nasce dele.",
          );
        }
      } else {
        const comEsteNome = lista.filter((p) => chaveDoNome(p.nome) === chaveDoNome(nome));
        if (comEsteNome.length > 1) {
          throw new Recusa(
            `planos[${i}]: há ${comEsteNome.length} planos chamados «${nome}» nesta organização. Informe o \`id\`: ${comEsteNome.map((p) => p.id).join(", ")}.`,
          );
        }
        existente = comEsteNome[0];
      }
      const id = existente?.id ?? idDoNome(nome, usados);
      if (vistosNoPedido.has(id)) {
        throw new Recusa(`planos[${i}]: o plano «${nome}» aparece duas vezes no pedido. Mande cada plano uma vez só.`);
      }
      vistosNoPedido.add(id);
      usados.add(id);

      const passos = pedido.passos.map((s, j) => ({
        ordem: j + 1,
        titulo: s.titulo.trim(),
        descricao: s.descricao?.trim() ? s.descricao.trim() : null,
        vence_em_dias: s.vence_em_dias,
        prioridade: s.prioridade ?? "medium",
        atribuir_a: responsavelDoPasso(s.responsavel, () => equipe, `planos[${i}].passos[${j}]`),
      }));
      const desejado: PlanoDeTarefas = {
        id,
        nome,
        descricao: pedido.descricao === undefined ? (existente?.descricao ?? null) : pedido.descricao?.trim() || null,
        passos,
      };

      if (existente) {
        const igual = mesmoConteudo(existente, desejado);
        if (!igual) Object.assign(existente, desejado);
        resultado.push({ id, nome, passos: passos.length, desfecho: igual ? "ja_estava" : "atualizou" });
      } else {
        lista.push(desejado);
        resultado.push({ id, nome, passos: passos.length, desfecho: "criou" });
      }
    }

    // A régua da tela, sobre a lista INTEIRA que vai ser gravada.
    const conferida = planosSchema.safeParse(lista);
    if (!conferida.success) {
      const problema = conferida.error.issues[0];
      const caminho = (problema?.path ?? []).map(String).join(".");
      throw new Recusa(
        `Os planos de tarefa não passaram na conferência${caminho ? ` (${caminho})` : ""}: ${problema?.message ?? "valor não aceito"}. ` +
          `A régua: até ${TETO_DE_PLANOS} planos por empresa, nome de 1 a 120 caracteres, de 1 a ${TETO_DE_PASSOS} passos por plano, ` +
          "título do passo de 1 a 200 caracteres e prazo de 0 a 365 dias.",
      );
    }
    total = lista.length;
    gravados = lista;
    if (resultado.every((r) => r.desfecho === "ja_estava")) return null;
    return { ...settings, task_plans: conferida.data };
  });

  if (mudou) {
    void audit({
      action: "task_plans.settings_updated",
      actorUserId: c.autorUserId,
      organizationId: c.orgId,
      resourceType: "organization",
      resourceId: c.orgId,
      requestId: c.requestId,
      metadata: {
        planos: gravados.length,
        mudancas: resultado.filter((r) => r.desfecho !== "ja_estava").map((r) => ({ id: r.id, desfecho: r.desfecho })),
        via: "mcp_plataforma",
      },
    });
  }
  if (mudou && descartados > 0) {
    avisos.push(
      `${descartados} plano(s) gravado(s) fora da régua (à mão, sem passar pela tela) não era(m) lido(s) pelo motor e saiu(íram) da lista, como sai no salvamento da tela.`,
    );
  }
  if (resultado.some((r) => r.desfecho === "criou")) {
    avisos.push(
      "Um plano só roda quando uma regra de automação o aplica: plataforma_garantir_automacao com a ação " +
        '{ "type": "apply_task_plan", "config": { "plano_id": "<id>" } }, e depois plataforma_ligar_automacao.',
    );
  }
  return { planos: resultado, total_na_empresa: total, avisos };
}

/** Os planos para a leitura: o responsável de cada passo pelo e-mail, quando dá. */
export function retratoDosPlanos(settings: Record<string, unknown>, membros: Membro[]): Array<Record<string, unknown>> {
  return planosGravados(settings).map((p) => ({
    id: p.id,
    nome: p.nome,
    descricao: p.descricao,
    passos: p.passos.map((s) => ({
      ordem: s.ordem,
      titulo: s.titulo,
      descricao: s.descricao,
      vence_em_dias: s.vence_em_dias,
      prioridade: s.prioridade,
      responsavel:
        s.atribuir_a === "dono_do_lead"
          ? "dono_do_lead"
          : (membros.find((m) => m.user_id === (s.atribuir_a as { usuario_id: string }).usuario_id)?.email ??
            (s.atribuir_a as { usuario_id: string }).usuario_id),
    })),
  }));
}

