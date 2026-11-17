/**
 * FORK MIA — a LISTA DE ESPERA da agenda pela implantação (upstream 9235,
 * #3414, doc 208), e a leitura dos LUGARES com capacidade (upstream 9224).
 *
 * ── Onde o upstream guarda cada coisa ─────────────────────────────────────
 *
 * A lista de espera é MÓDULO DE TABELA (ADR-0002): `calendar_waitlist` só existe
 * onde alguém instalou `lista_de_espera` em Admin › Módulos. Os prazos e a chave
 * são da EMPRESA, não do tipo de agendamento: `organizations.settings.lista_de_espera`,
 * conferidos por `configDaListaDeEsperaSchema` (sem padrão: os três prazos vêm
 * juntos, ou nada liga). Quem entra na fila escolhe o serviço na inscrição.
 *
 * O lugar com capacidade (mesa, camarote, quadra) é um recurso `kind='space'`
 * ligado ao serviço. Gravar passa por `fn_calendar_service_resource` e
 * `fn_calendar_service_configure`, que conferem o ator como gerente MEMBRO da
 * empresa ou token DELA: o token de plataforma não é nenhum dos dois. É a mesma
 * razão da .86 para a programação do serviço ficar na tela. Aqui fica a leitura.
 *
 * ── A gravação ────────────────────────────────────────────────────────────
 *
 * Espelho de `PATCH /api/v1/agenda/lista-de-espera` (a impressão da rota mora
 * em `tests/unit/mcp-de-implantacao-espelhos.test.ts`): o mesmo schema, a mesma
 * chave de settings, a mesma auditoria. Com o módulo NÃO instalado a rota
 * responde 404; aqui a recusa diz "módulo não instalado" e quem instala. O MCP
 * NUNCA instala: instalar cria tabela, e isso é decisão de quem administra a
 * instalação.
 */
import { configDaListaDeEsperaSchema, type ConfigDaListaDeEspera } from "@/lib/agenda/lista-de-espera";
import { audit } from "@/lib/audit";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { Recusa } from "@/lib/mcp-plataforma/recusa";
import type { createAdminClient } from "@/lib/supabase/admin";

import { mesmoConteudo, mudarSettingsDaOrganizacao, type Desfecho, type Implantacao } from "./base";

/** A chave de `organizations.settings` que a rota da tela grava. */
const CHAVE = "lista_de_espera";

export const RECUSA_MODULO_NAO_INSTALADO =
  "módulo não instalado: a lista de espera da agenda é um módulo opcional, e esta instalação não o tem. " +
  "O MCP não instala módulo: quem administra a instalação instala em Admin › Módulos › Lista de espera da agenda. " +
  "Nada foi gravado.";

export interface PedidoDaListaDeEspera {
  ligada: boolean;
  prazo_maximo_minutos?: number;
  margem_antes_minutos?: number;
  prazo_minimo_minutos?: number;
}

/** O que está gravado, lido pela régua da rota. Inválido ou ausente = `null`. */
export function configGravada(settings: Record<string, unknown>): ConfigDaListaDeEspera | null {
  const lida = configDaListaDeEsperaSchema.safeParse(settings[CHAVE]);
  return lida.success ? lida.data : null;
}

export async function configurarListaDeEspera(
  c: Implantacao,
  pedido: PedidoDaListaDeEspera,
): Promise<{ desfecho: Desfecho; lista_de_espera: ConfigDaListaDeEspera | null; aviso?: string }> {
  if (!(await moduloLigado(c.admin, "lista_de_espera"))) throw new Recusa(RECUSA_MODULO_NAO_INSTALADO);

  const admin = c.admin as ReturnType<typeof createAdminClient>;
  let gravada: ConfigDaListaDeEspera | null = null;
  let desfecho: Desfecho = "ja_estava";

  const { mudou } = await mudarSettingsDaOrganizacao(admin, c.orgId, (settings) => {
    const atual = configGravada(settings);
    const semPrazos =
      pedido.prazo_maximo_minutos === undefined &&
      pedido.margem_antes_minutos === undefined &&
      pedido.prazo_minimo_minutos === undefined;
    // Desligar o que nunca foi ligado: já está desligada, e não há prazo a pedir.
    if (!pedido.ligada && !atual && semPrazos) return null;
    // Os prazos que não vieram ficam os gravados: desligar não pede os três de novo.
    const candidata = {
      ativa: pedido.ligada,
      prazo_maximo_minutos: pedido.prazo_maximo_minutos ?? atual?.prazo_maximo_minutos,
      margem_antes_minutos: pedido.margem_antes_minutos ?? atual?.margem_antes_minutos,
      prazo_minimo_minutos: pedido.prazo_minimo_minutos ?? atual?.prazo_minimo_minutos,
    };
    const conferida = configDaListaDeEsperaSchema.safeParse(candidata);
    if (!conferida.success) {
      const faltam = (["prazo_maximo_minutos", "margem_antes_minutos", "prazo_minimo_minutos"] as const).filter(
        (k) => candidata[k] === undefined,
      );
      throw new Recusa(
        faltam.length > 0
          ? `escolha os três prazos antes de ligar a lista de espera (a tela pede o mesmo, e não há padrão): falta ${faltam.join(", ")}. Nada foi gravado.`
          : `os prazos não fecham: ${conferida.error.issues.map((i) => i.message).join("; ")}. O prazo mínimo não pode passar do máximo. Nada foi gravado.`,
      );
    }
    gravada = conferida.data;
    if (atual && mesmoConteudo(atual, conferida.data)) return null;
    desfecho = atual ? "atualizou" : "criou";
    return { ...settings, [CHAVE]: conferida.data };
  });

  const config = gravada as ConfigDaListaDeEspera | null;
  if (mudou && config) {
    // A mesma linha de `PATCH /api/v1/agenda/lista-de-espera`.
    void audit({
      action: "agenda.lista_de_espera_configurada",
      organizationId: c.orgId,
      actorUserId: c.autorUserId,
      requestId: c.requestId,
      resourceType: "organization",
      resourceId: c.orgId,
      metadata: { ...config, via: "mcp_plataforma" },
    });
  }
  return {
    desfecho: mudou ? desfecho : "ja_estava",
    lista_de_espera: config,
    ...(config?.ativa
      ? {
          aviso:
            "Ligada: quando um horário abrir, o sistema OFERECE a vaga pelo WhatsApp a uma pessoa da fila por vez. " +
            "Só entra na fila quem aceitou ser avisado (a inscrição é pela tela Agenda › Lista de espera).",
        }
      : {}),
  };
}

/** Um lugar (mesa, camarote, quadra) de um serviço, como a leitura devolve. */
export interface LugarDoServico {
  id: string;
  nome: string;
  area: string | null;
  capacidade_de_pessoas: number;
  ativo: boolean;
}

/**
 * Os lugares de cada serviço, por tipo (upstream 9224). Só os `kind='space'`:
 * o recurso comum continua sendo exigência e não é "lugar".
 */
export async function lerLugaresPorTipo(
  admin: Implantacao["admin"],
  orgId: string,
): Promise<Map<string, LugarDoServico[]>> {
  const { data: vinculos, error } = await admin
    .from("calendar_service_resources")
    .select("event_type_id, resource_id")
    .eq("organization_id", orgId);
  if (error) throw new Error(`não consegui ler os recursos dos serviços: ${error.message}`);
  const lista = (vinculos ?? []) as Array<{ event_type_id: string; resource_id: string }>;
  const porTipo = new Map<string, LugarDoServico[]>();
  if (lista.length === 0) return porTipo;

  const { data: recursos, error: erroRecursos } = await admin
    .from("calendar_resources")
    .select("id, name, capacity, kind, sector, is_active")
    .eq("organization_id", orgId)
    .eq("kind", "space")
    .in("id", [...new Set(lista.map((v) => v.resource_id))]);
  if (erroRecursos) throw new Error(`não consegui ler os lugares: ${erroRecursos.message}`);
  const lugares = new Map(
    ((recursos ?? []) as Array<{ id: string; name: string; capacity: number; sector: string | null; is_active: boolean | null }>).map(
      (r) => [r.id, { id: r.id, nome: r.name, area: r.sector ?? null, capacidade_de_pessoas: r.capacity, ativo: r.is_active !== false }],
    ),
  );
  for (const v of lista) {
    const lugar = lugares.get(v.resource_id);
    if (!lugar) continue;
    porTipo.set(v.event_type_id, [...(porTipo.get(v.event_type_id) ?? []), lugar]);
  }
  for (const l of porTipo.values()) l.sort((a, b) => a.nome.localeCompare(b.nome));
  return porTipo;
}

/** A lista de espera para a leitura da seção `agenda`. */
export async function lerListaDeEspera(
  admin: Implantacao["admin"],
  settings: Record<string, unknown>,
): Promise<{ modulo_instalado: boolean; ligada: boolean; prazos: Omit<ConfigDaListaDeEspera, "ativa"> | null }> {
  const instalado = await moduloLigado(admin, "lista_de_espera");
  const config = configGravada(settings);
  return {
    modulo_instalado: instalado,
    // A régua de `configDaEspera`: sem o módulo, nada é oferecido, por mais que a chave diga.
    ligada: instalado && config?.ativa === true,
    prazos: config
      ? {
          prazo_maximo_minutos: config.prazo_maximo_minutos,
          margem_antes_minutos: config.margem_antes_minutos,
          prazo_minimo_minutos: config.prazo_minimo_minutos,
        }
      : null,
  };
}
