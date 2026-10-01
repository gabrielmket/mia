/**
 * FORK MIA — o CONTRATO dos tipos de agendamento, fora do Route Handler.
 *
 * As categorias, os locais, os campos com as faixas de cada um e a conta do
 * slug moravam dentro de `app/api/v1/agenda/tipos/route.ts`, e um arquivo de
 * rota não exporta nada além dos métodos HTTP. O MCP de plataforma cria e
 * altera tipos ao implantar um cliente e precisa validar com o MESMO contrato:
 * uma segunda cópia destas faixas é o caso clássico de a tela aceitar o que a
 * ferramenta recusa (ou o contrário). O bloco veio para cá sem mudar uma linha
 * das regras; a rota importa daqui.
 */
import { z } from "zod";

import { TETO_DE_LEMBRETES_EXTRAS } from "@/lib/agenda/lembretes";

/** As dez do CHECK da tabela. Fora daqui o Postgres recusa — melhor recusar antes. */
export const CATEGORIAS_DE_TIPO = [
  "consulta", "procedimento", "retorno", "visita", "vistoria",
  "reuniao", "call", "orcamento", "demonstracao", "outro",
] as const;

export const LOCAIS_DE_TIPO = ["in_person", "phone", "whatsapp", "video_link", "google_meet"] as const;

/**
 * Os limites são os MESMOS do CHECK do banco, e isso é deliberado.
 *
 * Zod aqui não substitui a constraint: ela é a verdade e continua valendo para
 * quem escrever por SQL. O que a validação faz é transformar um 500 de constraint
 * — que aparece como "erro interno" para quem está usando — numa recusa 422 que
 * diz o que está fora.
 */
export const camposDoTipo = {
  name: z.string().trim().min(2).max(80),
  category: z.enum(CATEGORIAS_DE_TIPO),
  duration_minutes: z.number().int().min(5).max(1440),
  location_kind: z.enum(LOCAIS_DE_TIPO),
  description: z.string().trim().max(500).nullish(),
  location_details: z.string().trim().max(300).nullish(),
  default_owner_user_id: z.string().uuid().nullish(),
  requires_confirmation: z.boolean().optional(),
  buffer_before_minutes: z.number().int().min(0).max(720).optional(),
  buffer_after_minutes: z.number().int().min(0).max(720).optional(),
  minimum_notice_minutes: z.number().int().min(0).max(43_200).optional(),
  booking_window_days: z.number().int().min(1).max(365).optional(),
  /**
   * O LEMBRETE — os dois campos que o cron `agenda-reminder` lê e que ninguém
   * conseguia escrever.
   *
   * A 0177 criou as colunas, a 0194 as pôs em `default false` deixando escrito
   * que ligar por padrão "fica com o dono do produto NO DIA em que o disparador
   * nascer", e o `99c33257` fez o disparador nascer. Faltava a outra metade do
   * par: `reminder_enabled` não estava em schema nenhum aqui nem na tela, então
   * a rodada do cron devolvia zero linhas em TODA instalação — capacidade que
   * existe e não tem como ser usada (invariante 6 do Sistema Vivo).
   *
   * **Continua nascendo desligado.** Não há `.default(true)`: quem não manda o
   * campo não liga nada, e o default da coluna segue sendo `false`. Mandar
   * mensagem para o telefone de um cliente é irreversível.
   */
  reminder_enabled: z.boolean().optional(),
  /**
   * ⚠️ ESTA FAIXA É MAIS ESTREITA QUE O CHECK DO BANCO, E ISSO CONTRARIA O
   * PARÁGRAFO ACIMA DE PROPÓSITO.
   *
   * A coluna aceita `between 0 and 43200`, e os campos vizinhos copiam o CHECK
   * porque lá a borda do banco É a borda do sentido: `buffer_after_minutes = 0`
   * é "sem folga", uma configuração legítima. Aqui as duas bordas do CHECK
   * produzem lembrete que não lembra:
   *
   * - **0 min** nunca sai. `estaNaHora` recusa `comeca <= agora`, então um
   *   lembrete marcado para o próprio instante do compromisso é descartado em
   *   toda rodada até a linha sair da varredura. O piso é 15 min porque o cron
   *   roda a cada 5: abaixo de três ciclos, uma rodada atrasada come a
   *   antecedência inteira e o aviso chega depois de a pessoa já ter saído.
   * - **43200 min (30 dias)** não é lembrete, é convite. O teto é 10080 (7
   *   dias), que cobre o "semana que vem" de clínica e imobiliária.
   *
   * A borda continua sendo do banco para quem escreve por SQL — aqui a recusa é
   * só antes, com nome. Uma linha semeada fora desta faixa (só por SQL direto;
   * o default da 0177 é 1440) segue valendo no banco e o cron a respeita: o que
   * ela perde é poder ser reenviada por esta rota sem entrar na faixa.
   */
  /**
   * O PREÇO PADRÃO do serviço, em centavos.
   *
   * Opcional e sem default: nem todo negócio tem preço fixo, e obrigar um número
   * faria quem cobra por hora inventar um. Vazio significa "digite na hora".
   *
   * É semente do item da comanda, nunca o preço dele — o item congela o seu.
   */
  default_price_cents: z.number().int().min(0).max(100_000_000).nullish(),
  reminder_minutes_before: z
    .number()
    .int()
    .min(15, { message: "O lembrete precisa sair pelo menos 15 minutos antes do compromisso." })
    .max(10_080, { message: "O lembrete não pode sair mais de 7 dias (10080 minutos) antes." })
    .optional(),
  /**
   * Os degraus ADICIONAIS — o "e de novo três horas antes" que faltava.
   *
   * `reminder_minutes_before` continua sendo o degrau principal; estes somam a
   * ele. Vazio é o comportamento anterior, um lembrete só, e por isso o campo
   * não tem `.default()`: quem não manda não ganha aviso nenhum a mais.
   *
   * O teto é o mesmo do CHECK (`fn_degraus_de_lembrete_validos`): guarda contra
   * laço de formulário, não contra a operação. Quem decide quantos avisos o
   * cliente recebe é quem edita o tipo.
   */
  reminder_extra_offsets_minutes: z
    .array(
      z
        .number()
        .int()
        .min(15, { message: "O lembrete precisa sair pelo menos 15 minutos antes do compromisso." })
        .max(10_080, { message: "O lembrete não pode sair mais de 7 dias (10080 minutos) antes." }),
    )
    .max(TETO_DE_LEMBRETES_EXTRAS, {
      message: `No máximo ${TETO_DE_LEMBRETES_EXTRAS} lembretes adicionais por tipo.`,
    })
    // Duplicata não é erro de quem preenche, é ruído: dois degraus iguais
    // produziriam o mesmo aviso duas vezes se algum dia alguém lesse a lista
    // sem deduplicar. Some aqui, uma vez, em vez de virar guarda em cada leitor.
    .transform((v) => [...new Set(v)].sort((a, b) => b - a))
    .optional(),
};

export const criarSchema = z.object(camposDoTipo);
// `.partial()` em vez de repetir os doze campos como opcionais: repetir criaria
// duas listas para manter em sincronia, e a segunda envelhece calada.
export const alterarSchema = criarSchema.partial().extend({
  id: z.string().uuid(),
  /**
   * O TEXTO que o cron manda. Vazio/nulo = a frase padrão. Distinto de
   * `reminder_template_name` (nome do template no provedor oficial).
   *
   * Mora só no PATCH de propósito: o tipo nasce com a frase de fábrica, e
   * quem quer outra escreve depois. No POST, o campo nem entra — senão um
   * `""` no nascimento gravaria nulo por cima do default, e a ausência no
   * formulário de criação deixaria de ser ausência.
   *
   * Transforma string em branco em `null` para o PATCH poder VOLTAR ao padrão
   * sem um campo-sentinela: quem apaga o textarea está pedindo o texto de
   * fábrica, não uma mensagem vazia no WhatsApp.
   */
  reminder_body: z
    .string()
    .max(1000, { message: "A mensagem do lembrete cabe em 1000 caracteres." })
    .nullish()
    .transform((v) => (v == null ? v : v.trim() === "" ? null : v.trim())),
  /**
   * Texto de cada extra. Chave = minutos antes. String em branco some do mapa
   * (cai na frase de fábrica). Mora só no PATCH pelo mesmo motivo de
   * `reminder_body`: o tipo nasce sem texto próprio.
   */
  reminder_bodies: z
    .record(
      z.string().regex(/^\d+$/),
      z.string().max(1000, { message: "A mensagem do lembrete cabe em 1000 caracteres." }),
    )
    .optional()
    .transform((v) => {
      if (!v) return v;
      const out: Record<string, string> = {};
      for (const [k, corpo] of Object.entries(v)) {
        const t = corpo.trim();
        if (t) out[k] = t;
      }
      return out;
    }),
});

/**
 * O slug sai do NOME, e é estável depois de criado.
 *
 * A ferramenta MCP aceita `event_type_slug`, então o slug é endereço público: se
 * ele mudasse ao renomear o tipo, todo playbook e toda automação que o citam
 * parariam de achar — em silêncio, porque a busca por slug devolve "não existe"
 * e não "mudou de nome". Por isso o PATCH nunca o toca.
 */
export function slugDe(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "tipo";
}
