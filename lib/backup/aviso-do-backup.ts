/**
 * FORK MIA (.62) — AVISAR QUEM OPERA QUANDO O BACKUP PARA.
 *
 * `/api/v1/health` responde `backup.em_dia` para um monitor de fora (o n8n). Isto
 * é a metade de DENTRO: o próprio sistema chama os administradores da plataforma
 * (`platform_admins`), pelo que ele já tem para isso:
 *
 *  - um INCIDENTE de plataforma (`incidents`, sem organização), que é o registro
 *    — aparece em /admin/incidents, com a data da última cópia e o estado do
 *    envio, e é resolvido sozinho quando o backup volta;
 *  - um PUSH para os aparelhos dos administradores, que é a campainha — abre o
 *    incidente.
 *
 * ─── No máximo uma vez por dia ───────────────────────────────────────────────
 *
 * O vigia roda a cada 10 minutos (`cron/report-da-plataforma`), e um backup
 * parado continua parado. A trava é a mesma do report interno
 * (`platform_avisos_enviados`, chave por problema, janela de 24 h): o mesmo
 * problema rende um aviso por dia enquanto durar, não 144. E ela é RESERVADA
 * ANTES de avisar: se gravar a trava falhar, o aviso não sai — um alarme que se
 * repete a cada 10 minutos é desligado por quem o recebe no segundo dia.
 *
 * ─── Dois problemas, dois avisos ─────────────────────────────────────────────
 *
 *   atrasado   a última cópia completa tem mais de 26 h (ou nunca houve uma)
 *   sem_envio  a última cópia está pronta e não chegou ao Drive em 2 h
 *
 * O segundo não entra em `em_dia` (a cópia existe), mas é backup que não
 * protege do pior caso — a VPS morrer leva a cópia junto — e o remédio é outro
 * (a credencial do Google, não o banco). Chaves separadas: consertar um e cair
 * no outro não fica calado até o dia seguinte.
 *
 * Desconhecido (sem tabela, sem permissão, sem a função) NÃO avisa aqui: num
 * ambiente de teste isso seria um alarme por dia para sempre. Em produção é o
 * monitor de fora quem pega (`em_dia !== true`).
 *
 * Nada aqui lança: o vigia divide a rodada com os outros avisos da plataforma.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { jaAvisou } from "@/lib/avisos/report-da-plataforma";
import { logger } from "@/lib/logger";
import { enviarPushAosAdminsDaPlataforma } from "@/lib/notifications/push-da-plataforma";
import { truncar, type PushPayload } from "@/lib/notifications/push_payload";

import { HORAS_PARA_EM_DIA, HORAS_PARA_O_ENVIO, type EstadoDoBackup } from "./estado-do-backup";

export type ProblemaDoBackup = "atrasado" | "sem_envio";

/** O `type` do incidente — é o que aparece na lista de /admin/incidents. */
export const TIPO_DO_INCIDENTE: Record<ProblemaDoBackup, string> = {
  atrasado: "backup_atrasado",
  sem_envio: "backup_sem_envio",
};

/** A chave da trava em `platform_avisos_enviados`. */
export const CHAVE_DO_AVISO: Record<ProblemaDoBackup, string> = {
  atrasado: "backup:atrasado",
  sem_envio: "backup:sem_envio",
};

/** Um aviso por problema a cada 24 h, enquanto ele durar. */
export const JANELA_DO_AVISO_EM_HORAS = 24;

const PROBLEMAS: readonly ProblemaDoBackup[] = ["atrasado", "sem_envio"];

/** Quais problemas o estado tem AGORA. Desconhecido não tem nenhum (ver o cabeçalho). */
export function problemasDoBackup(estado: EstadoDoBackup): ProblemaDoBackup[] {
  if (estado.estado === "desconhecido") return [];
  const problemas: ProblemaDoBackup[] = [];
  if (!estado.em_dia) problemas.push("atrasado");
  if (estado.envio_ao_drive === "falhou") problemas.push("sem_envio");
  return problemas;
}

/** `2026-09-29T06:01:00.000Z` → `29/09/2026 06:01 UTC`, sem depender de idioma do servidor. */
function dataUtc(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 16)} UTC`;
}

/** O texto do push. Curto: a tela bloqueada corta, e o detalhe mora no incidente. */
export function textoDoAviso(
  problema: ProblemaDoBackup,
  estado: EstadoDoBackup,
): { title: string; body: string } {
  const ultima = estado.estado !== "desconhecido" ? estado.ultima_copia_em : null;
  if (problema === "sem_envio") {
    return {
      title: "Backup não chegou ao Drive",
      body: ultima
        ? `A cópia de ${dataUtc(ultima)} está só no servidor: o envio ao Google Drive não foi confirmado.`
        : "A última cópia está só no servidor: o envio ao Google Drive não foi confirmado.",
    };
  }
  return {
    title: "Backup do banco atrasado",
    body: ultima
      ? `A última cópia completa do banco é de ${dataUtc(ultima)}. O backup diário parou.`
      : "O backup diário nunca completou uma cópia deste banco.",
  };
}

export interface DependenciasDoVigia {
  /** Quem toca a campainha. Padrão: push aos administradores da plataforma. */
  enviarPush?: (admin: SupabaseClient, payload: PushPayload) => Promise<unknown>;
}

async function avisar(
  admin: SupabaseClient,
  problema: ProblemaDoBackup,
  estado: EstadoDoBackup,
  enviarPush: NonNullable<DependenciasDoVigia["enviarPush"]>,
): Promise<boolean> {
  const chave = CHAVE_DO_AVISO[problema];
  // Em dúvida, `jaAvisou` responde que sim: erro de leitura não vira enxurrada.
  if (await jaAvisou(admin, chave, JANELA_DO_AVISO_EM_HORAS)) return false;

  const ultima = estado.estado !== "desconhecido" ? estado.ultima_copia_em : null;
  const envio = estado.estado !== "desconhecido" ? estado.envio_ao_drive : null;
  const detalhe = { ultima_copia_em: ultima, envio_ao_drive: envio };

  // A trava ANTES do aviso: sem ela gravada, não avisa (ver o cabeçalho).
  const { error: erroDaTrava } = await admin
    .from("platform_avisos_enviados")
    .upsert({ chave, enviado_em: new Date().toISOString(), detalhe }, { onConflict: "chave" });
  if (erroDaTrava) {
    logger.warn("[backup] não gravei a trava do aviso; não aviso para não repetir", {
      chave,
      detail: erroDaTrava.message,
    });
    return false;
  }

  const { data: incidente, error: erroDoIncidente } = await admin
    .from("incidents")
    .insert({
      organization_id: null,
      type: TIPO_DO_INCIDENTE[problema],
      severity: "critical",
      payload: {
        ...detalhe,
        regra:
          problema === "atrasado"
            ? `cópia completa de menos de ${HORAS_PARA_EM_DIA} h`
            : `cópia enviada ao Drive em até ${HORAS_PARA_O_ENVIO} h`,
        onde_conferir: "infra/supabase-sistema-mia/BACKUP.md, seção Como conferir",
      },
    })
    .select("id")
    .maybeSingle();
  if (erroDoIncidente) {
    // Sem o registro, o push ainda sai: a campainha sem a ficha é melhor que
    // silêncio, e o log diz por que a lista de incidentes ficou sem a linha.
    logger.warn("[backup] o incidente não gravou; o push sai mesmo assim", {
      problema,
      detail: erroDoIncidente.message,
    });
  }
  const id = (incidente as { id?: string } | null)?.id;

  const { title, body } = textoDoAviso(problema, estado);
  await enviarPush(admin, {
    title,
    body: truncar(body),
    tag: `backup:${problema}`,
    href: id ? `/admin/incidents/${id}` : "/admin/incidents",
  });
  return true;
}

/** O problema passou: fecha o incidente aberto dele, com o porquê. */
async function resolver(
  admin: SupabaseClient,
  problema: ProblemaDoBackup,
  estado: EstadoDoBackup,
): Promise<boolean> {
  const ultima = estado.estado !== "desconhecido" ? estado.ultima_copia_em : null;
  const { data, error } = await admin
    .from("incidents")
    .update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolution_note:
        problema === "atrasado"
          ? `O backup voltou a ficar em dia${ultima ? ` (cópia de ${dataUtc(ultima)})` : ""}.`
          : "A cópia chegou ao Drive.",
    })
    .is("organization_id", null)
    .eq("type", TIPO_DO_INCIDENTE[problema])
    .neq("status", "resolved")
    .select("id");
  if (error) {
    logger.warn("[backup] não fechei o incidente resolvido", { problema, detail: error.message });
    return false;
  }
  return ((data ?? []) as unknown[]).length > 0;
}

/**
 * Uma rodada do vigia: avisa o que está errado (uma vez por dia por problema) e
 * fecha o incidente do que voltou ao normal. Desconhecido não avisa nem fecha —
 * não se sabe.
 */
export async function vigiarBackup(
  admin: SupabaseClient,
  estado: EstadoDoBackup,
  deps: DependenciasDoVigia = {},
): Promise<{ avisados: ProblemaDoBackup[]; resolvidos: ProblemaDoBackup[] }> {
  const enviarPush = deps.enviarPush ?? enviarPushAosAdminsDaPlataforma;
  const atuais = problemasDoBackup(estado);
  const avisados: ProblemaDoBackup[] = [];
  const resolvidos: ProblemaDoBackup[] = [];

  for (const problema of PROBLEMAS) {
    try {
      if (atuais.includes(problema)) {
        if (await avisar(admin, problema, estado, enviarPush)) avisados.push(problema);
      } else if (estado.estado !== "desconhecido") {
        if (await resolver(admin, problema, estado)) resolvidos.push(problema);
      }
    } catch (err) {
      logger.warn("[backup] o vigia tropeçou", {
        problema,
        detail: err instanceof Error ? err.message : "erro",
      });
    }
  }
  return { avisados, resolvidos };
}
