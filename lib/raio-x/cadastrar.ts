/**
 * FORK MIA (.107) · O CADASTRO DO RAIO-X GRÁTIS, de ponta a ponta (a rota
 * `POST /api/v1/publico/raio-x/cadastro` chama isto depois de validar).
 *
 * Na ordem do brief da .107:
 *   1. acha ou cria a CONTA pelo e-mail (atualiza o nome e o WhatsApp da pessoa);
 *   2. confere a GRÁTIS: uma por número analisado (as duas grafias do nono
 *      dígito) e uma por conta. Já usada: não cria nada grátis, e o lead da Time
 *      é atualizado mesmo assim;
 *   3. cria o RAIO-X: pela conexão, diagnóstico único, 30 dias, teto de R$ 10,
 *      origem 'cadastro', grátis, ligado à conta, `criado_via` 'cadastro';
 *   4. grava o ACEITE na hora (nome completo, e-mail, termo v1, o texto inteiro)
 *      e prepara a sessão do leitor, como a rota de aceite faz: a página de
 *      conexão abre direto na etapa de conectar;
 *   5. cria o LEAD no CRM da Time (`lead-da-time.ts`);
 *   6. manda o e-mail "seu Raio-X começou" com o link de conexão e como entrar
 *      na área.
 *
 * O lead e o e-mail são melhor esforço: o cadastro da pessoa nunca quebra por
 * causa deles. A auditoria é de quem chama (a rota).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { leitorDoRaioX, type LeitorDoRaioX } from "@/lib/channels/raio-x/leitor";
import { logger } from "@/lib/logger";

import { criarRaioX, lerRaioX, registrarAceite, type LinhaDoRaioX } from "./banco";
import { PERIODO_DO_GRATIS, TETO_DO_GRATIS_CENTAVOS, type CadastroValido } from "./cadastro";
import { acharOuCriarConta, gratisUsada, type LinhaDaConta } from "./contas";
import { emailDeComecou, enviarEmailDoRaioX, type EnviarEmail } from "./emails";
import { anotarNoLead, enviarAoCrm, type DependenciasDoLead, type ResultadoDoLead } from "./lead-da-time";

export interface DependenciasDoCadastro {
  /** O leitor do raio-X (o padrão é o do ambiente; `null` = sem leitor). */
  leitor?: LeitorDoRaioX | null;
  lead?: DependenciasDoLead;
  enviarEmail?: EnviarEmail;
  agora?: Date;
}

export type DesfechoDoCadastro =
  | {
      tipo: "criado";
      conta: LinhaDaConta;
      raioX: LinhaDoRaioX;
      codigo: string;
      link: string;
      aceiteId: string;
      termoVersao: string;
      prontoParaParear: boolean;
      lead: ResultadoDoLead;
      emailSaiu: boolean;
    }
  | { tipo: "ja_usou"; conta: LinhaDaConta; raioXId: string; lead: ResultadoDoLead };

const ehDuplicado = (e: unknown) => e instanceof Error && e.message.includes("(23505)");

export async function cadastrar(admin: SupabaseClient, v: CadastroValido, deps: DependenciasDoCadastro = {}): Promise<DesfechoDoCadastro> {
  const agora = deps.agora ?? new Date();
  const conta = await acharOuCriarConta(admin, { email: v.email, nome: v.nome, telefone: v.telefone });
  const raioXDoLead = { empresa: v.empresa, segmento: v.segmento, whatsapp: v.whatsapp, quem_atende: v.quem_atende };

  const jaUsou = async (raioXId: string): Promise<DesfechoDoCadastro> => {
    const lead = await anotarNoLead(
      admin,
      {
        conta,
        raioX: raioXDoLead,
        raioXId,
        campos: { raio_x_situacao: "pediu a grátis de novo (já usada)" },
        nota: `Pediu o Raio-X grátis de novo para ${v.empresa}, mas a análise grátis deste número ou desta conta já foi usada. Bom momento para oferecer a nova análise.`,
      },
      deps.lead,
    );
    return { tipo: "ja_usou", conta, raioXId, lead };
  };

  const usada = await gratisUsada(admin, { contaId: conta.id, whatsapp: v.whatsapp });
  if (usada) return jaUsou(usada.id);

  let criado;
  try {
    criado = await criarRaioX(
      admin,
      {
        fonte: "conexao",
        empresa: v.empresa,
        segmento: v.segmento,
        whatsapp: v.whatsapp,
        numeros: [],
        responsavel_nome: v.nome,
        responsavel_contato: v.email,
        quem_atende: v.quem_atende,
        periodo_dias: PERIODO_DO_GRATIS,
        tipo: "unico",
        abre: v.abre,
        fecha: v.fecha,
        sabado_ate: v.sabado_ate,
        domingo_ate: v.domingo_ate,
        organization_id: null,
        teto_centavos: TETO_DO_GRATIS_CENTAVOS,
      },
      null,
      "cadastro",
      agora,
      null,
      { origem: "cadastro", gratis: true, contaId: conta.id },
    );
  } catch (erro) {
    // Dois cadastros iguais ao mesmo tempo: o índice da grátis segurou o segundo.
    if (ehDuplicado(erro)) {
      const outro = await gratisUsada(admin, { contaId: conta.id, whatsapp: v.whatsapp });
      if (outro) return jaUsou(outro.id);
    }
    throw erro;
  }

  // O aceite na hora: a pessoa marcou "Li e autorizo" no formulário.
  const aceite = await registrarAceite(admin, criado.raioX, { nome: v.nome, email: v.email });
  let prontoParaParear = false;
  const leitor = deps.leitor !== undefined ? deps.leitor : leitorDoRaioX();
  if (aceite.sessao && leitor) {
    try {
      prontoParaParear = (await leitor.preparar(aceite.sessao)).estado === "esperando_pareamento";
    } catch (erro) {
      // A página de conexão prepara de novo quando a pessoa pede o código ou o QR.
      logger.warn("[raio-x] o leitor não preparou a sessão do cadastro", { raioXId: criado.raioX.id, detail: erro instanceof Error ? erro.message : "erro" });
    }
  }
  const raioX = (await lerRaioX(admin, criado.raioX.id)) ?? criado.raioX;

  const lead = await enviarAoCrm(
    admin,
    { conta, raioX: raioXDoLead, origem: v.origem, extras: { raio_x_situacao: "cadastrado, aguardando conectar" } },
    deps.lead,
  );
  const emailSaiu = await enviarEmailDoRaioX(
    conta.email,
    (marca) => emailDeComecou({ nome: conta.nome, empresa: v.empresa, whatsapp: v.whatsapp, linkDeConexao: criado.link, email: conta.email }, marca),
    "comecou",
    deps.enviarEmail,
  );
  return {
    tipo: "criado",
    conta,
    raioX,
    codigo: criado.codigo,
    link: criado.link,
    aceiteId: aceite.aceiteId,
    termoVersao: aceite.termoVersao,
    prontoParaParear,
    lead,
    emailSaiu,
  };
}
