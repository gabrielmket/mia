/**
 * FORK MIA (.101) · O TERMO DE AUTORIZAÇÃO DO RAIO-X (decisão 6). PURO.
 *
 * ⚠️ RASCUNHO PARA O ADVOGADO. O texto da v1 foi escrito para o produto andar
 * e PRECISA passar por um advogado antes do lançamento
 * (`docs/fork/raio-x-do-atendimento.md`, seção 6). Trocou uma vírgula? É outra
 * versão: suba `VERSAO_DO_TERMO` e mantenha o texto antigo aqui, porque o aceite
 * guarda a versão e o texto INTEIRO que a pessoa leu (`mia_raio_x_aceites`).
 *
 * O dono é o CONTROLADOR dos dados dos clientes dele; a Time Company é a
 * OPERADORA, só para esta análise.
 */
import { createHash } from "node:crypto";

import { DIAS_ATE_APAGAR_AS_CONVERSAS, DIAS_ATE_DESCONECTAR, whatsappParaLer, type TipoDoRaioX } from "./regras";

export const VERSAO_DO_TERMO = "v1";

export interface DadosDoTermo {
  empresa: string;
  whatsapp: string;
  periodoDias: number;
  tipo: TipoDoRaioX;
}

/** O texto da v1, já com a empresa, o número e o período. É o que vai gravado no aceite. */
export function textoDoTermo(d: DadosDoTermo): string {
  const numero = whatsappParaLer(d.whatsapp);
  const conexao =
    d.tipo === "unico"
      ? `A conexão é encerrada automaticamente ${DIAS_ATE_DESCONECTAR} dias depois de o relatório ficar pronto.`
      : "No acompanhamento mensal, a conexão fica ativa e um relatório é gerado no dia 1 de cada mês, sobre o mês anterior, até a Empresa ou a Time encerrar.";
  return [
    `TERMO DE AUTORIZAÇÃO · RAIO-X DO ATENDIMENTO · versão ${VERSAO_DO_TERMO.slice(1)}`,
    "",
    `1. Quem é quem. A empresa ${d.empresa} ("Empresa"), representada por quem aceita este termo, é a CONTROLADORA dos dados pessoais dos clientes que conversam com o WhatsApp comercial ${numero}. A Time Company ("Time") é a OPERADORA: trata esses dados só por conta e ordem da Empresa e só para a finalidade abaixo.`,
    "",
    "2. Finalidade. Medir como está o atendimento comercial pelo WhatsApp (quanto tempo leva para responder, quem fica sem resposta, de onde vêm os clientes, o que perguntam e como as conversas terminam) e entregar à Empresa um relatório com o que melhorar.",
    "",
    `3. O que é lido. As conversas individuais dos últimos ${d.periodoDias} dias e as que chegarem até o relatório ficar pronto. Grupos, status e listas de transmissão ficam de fora. Os áudios são transcritos para entrar na análise. Fotos, vídeos e documentos são só contados: o conteúdo não é guardado.`,
    "",
    "4. Só leitura. Nenhuma mensagem é enviada, marcada como lida ou respondida a partir do número. A conexão aparece no WhatsApp como um aparelho conectado (\"Raio-X Time Company\") e a Empresa pode desconectá-la a qualquer momento, em WhatsApp › Aparelhos conectados.",
    "",
    "5. Como é feito. A leitura roda num servidor da Time. A transcrição dos áudios e a classificação das conversas usam serviços de inteligência artificial contratados pela Time (suboperadores), que recebem o texto sem telefone, e-mail ou documento, só para esta análise e conforme os termos de uso de API desses serviços.",
    "",
    `6. Prazos. ${conexao} As conversas lidas são apagadas dos servidores da Time ${DIAS_ATE_APAGAR_AS_CONVERSAS} dias depois do relatório (ou do encerramento, se ele vier antes). O relatório fica guardado, sem o telefone e sem o nome dos clientes, que aparecem só por um número de ordem, para comparar com o próximo raio-X e mostrar a evolução.`,
    "",
    "7. Segurança. Só a equipe da Time acessa as conversas e o relatório antes de ele ser entregue, e o que ela faz no raio-X (revisar, publicar, desconectar, encerrar) fica registrado. O relatório da Empresa abre por um link próprio, com validade, que a Time pode desligar.",
    "",
    "8. Direitos dos clientes da Empresa. Os pedidos dos titulares (acesso, correção, eliminação) são respondidos pela Empresa, como controladora. A Time apoia e apaga as conversas antes do prazo se a Empresa pedir.",
    "",
    "9. Riscos. A conexão usa o mesmo mecanismo do WhatsApp Web e não é a API oficial do WhatsApp. Como ela só lê, o risco é baixo, mas o WhatsApp pode, a critério dele, desconectar aparelhos.",
    "",
    `10. Declaração. Quem aceita declara ser responsável pelo WhatsApp ${numero}, ter poderes para autorizar este tratamento em nome da Empresa e que a Empresa tem base legal para ele (o legítimo interesse de melhorar o próprio atendimento). O aceite fica registrado com o nome de quem aceitou, a data, a hora e a versão deste termo.`,
  ].join("\n");
}

/** SHA-256 em hex do texto aceito: a prova de qual texto a pessoa leu. */
export function hashDoTermo(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex");
}
