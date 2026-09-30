/**
 * FORK MIA (.62) — O BACKUP DO BANCO ESTÁ EM DIA?
 *
 * ─── O buraco que isto fecha ─────────────────────────────────────────────────
 *
 * O banco de produção (serviço supabase-sistema-mia) tem backup diário às 06:00
 * UTC (`infra/supabase-sistema-mia/backup/fazer-backup.sh`), e cada rodada grava
 * uma linha em `operacao.backup`. O envio ao Google Drive (`enviar.sh`) marca
 * `enviado_em` depois de conferir a cópia no Drive. O único alarme era o
 * healthcheck do contêiner no painel do EasyPanel — que ninguém abre. Um backup
 * que falha em silêncio é descoberto no dia em que se precisa dele.
 *
 * ─── A régua ─────────────────────────────────────────────────────────────────
 *
 * `em_dia` = a última cópia COMPLETA (`ok = true`) ficou pronta há menos de
 * 26 h. É a mesma régua do healthcheck do contêiner (cópia PRONTO de menos de
 * 1560 min): o diário das 06:00, as três tentativas de meia em meia hora que o
 * script faz quando falha, e folga. Duas réguas diferentes para a mesma
 * pergunta dariam dois vereditos no mesmo minuto.
 *
 * O envio ao Drive é resposta SEPARADA (`envio_ao_drive`), e não entra em
 * `em_dia`: uma cópia que ficou só na VPS é um problema diferente (a VPS morrer
 * leva junto) e tem remédio diferente (a credencial do Google, não o banco).
 *
 *   ok        a última cópia completa foi enviada e conferida no Drive
 *   pendente  ainda não foi, e ficou pronta há menos de 2 h — o envio roda a
 *             cada 10 min e o registro chega ao banco na volta seguinte
 *   falhou    ainda não foi, e já passou das 2 h
 *
 * ─── Desconhecido não é "em dia" ─────────────────────────────────────────────
 *
 * Sem a tabela (ambiente de teste, o serviço de backup nunca rodou), sem
 * permissão, sem a função (o baseline não passou) ou com a leitura falhando, o
 * estado é `desconhecido` e `em_dia` é `null` — nunca `true`. Um monitor deve
 * tratar `em_dia !== true` como problema em produção; o vigia interno só avisa
 * no `atrasado` (o desconhecido de um ambiente de teste tocaria todo dia).
 *
 * Nada aqui carrega dado sensível: datas, um código de estado e um motivo em
 * código. A rota de saúde é pública.
 */

/** A régua de `em_dia`. A mesma do healthcheck do contêiner de backup. */
export const HORAS_PARA_EM_DIA = 26;

/** Até quanto tempo depois de pronta a cópia sem envio é "pendente", e não "falhou". */
export const HORAS_PARA_O_ENVIO = 2;

/** O nome da função do banco (migration 9006). */
export const FUNCAO_DO_ESTADO_DO_BACKUP = "fn_mia_estado_do_backup";

/** Uma linha de `fn_mia_estado_do_backup()`, como o PostgREST a devolve. */
export interface LinhaDoEstadoDoBackup {
  situacao: string;
  ultima_copia_em: string | null;
  enviada_em: string | null;
}

/** Por que não se sabe. `sem_tabela`/`sem_permissao` vêm da função; os outros, de quem lê. */
export type MotivoDoDesconhecido =
  | "sem_tabela"
  | "sem_permissao"
  | "sem_funcao"
  | "falha_de_leitura"
  | "nao_configurado";

/** A leitura, do jeito que chegou: a linha da função, ou por que ela não veio. */
export type LeituraDoBackup = LinhaDoEstadoDoBackup | { falha: MotivoDoDesconhecido };

export type EnvioAoDrive = "ok" | "pendente" | "falhou";

export type EstadoDoBackup =
  | {
      estado: "em_dia" | "atrasado";
      em_dia: boolean;
      /** Quando ficou pronta a última cópia completa. `null` = nunca houve uma. */
      ultima_copia_em: string | null;
      /** `null` quando não há cópia para enviar. */
      envio_ao_drive: EnvioAoDrive | null;
      /** Só quando nunca houve cópia completa: `sem_copia`. */
      motivo?: "sem_copia";
    }
  | {
      estado: "desconhecido";
      em_dia: null;
      motivo: MotivoDoDesconhecido;
    };

const UMA_HORA = 60 * 60 * 1000;

function instante(texto: string | null): number | null {
  if (!texto) return null;
  const t = new Date(texto).getTime();
  return Number.isFinite(t) ? t : null;
}

/** A leitura da função, julgada contra o relógio. Pura: o relógio vem de fora. */
export function avaliarBackup(leitura: LeituraDoBackup, agora: Date): EstadoDoBackup {
  if ("falha" in leitura) return { estado: "desconhecido", em_dia: null, motivo: leitura.falha };

  if (leitura.situacao === "sem_tabela" || leitura.situacao === "sem_permissao") {
    return { estado: "desconhecido", em_dia: null, motivo: leitura.situacao };
  }

  // A tabela existe e nunca houve cópia completa: é o backup que nunca deu
  // certo, não um ambiente sem backup. É atraso, e dos piores.
  if (leitura.situacao === "sem_copia") {
    return {
      estado: "atrasado",
      em_dia: false,
      ultima_copia_em: null,
      envio_ao_drive: null,
      motivo: "sem_copia",
    };
  }

  const pronta = instante(leitura.ultima_copia_em);
  if (leitura.situacao !== "ok" || pronta === null) {
    return { estado: "desconhecido", em_dia: null, motivo: "falha_de_leitura" };
  }

  const horas = (agora.getTime() - pronta) / UMA_HORA;
  const emDia = horas < HORAS_PARA_EM_DIA;
  const envio: EnvioAoDrive = instante(leitura.enviada_em) !== null
    ? "ok"
    : horas < HORAS_PARA_O_ENVIO
      ? "pendente"
      : "falhou";

  return {
    estado: emDia ? "em_dia" : "atrasado",
    em_dia: emDia,
    ultima_copia_em: new Date(pronta).toISOString(),
    envio_ao_drive: envio,
  };
}

/**
 * A leitura pelo cliente do Supabase (`.rpc`), no formato de `avaliarBackup`.
 *
 * `PGRST202` é o PostgREST dizendo que a função não existe no cache dele: o
 * baseline da 9006 não passou (ou o cache não recarregou). Diferente de falhar
 * a leitura, e o motivo diz qual dos dois.
 */
export function leituraDoRpc(resposta: {
  data: unknown;
  error: { code?: string; message?: string } | null;
}): LeituraDoBackup {
  if (resposta.error) {
    return { falha: resposta.error.code === "PGRST202" ? "sem_funcao" : "falha_de_leitura" };
  }
  const linhas = resposta.data;
  const linha = Array.isArray(linhas) ? (linhas[0] as LinhaDoEstadoDoBackup | undefined) : undefined;
  if (!linha || typeof linha.situacao !== "string") return { falha: "falha_de_leitura" };
  return {
    situacao: linha.situacao,
    ultima_copia_em: linha.ultima_copia_em ?? null,
    enviada_em: linha.enviada_em ?? null,
  };
}
