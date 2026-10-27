/**
 * FORK MIA (.89) — A ÁREA "E-MAIL MARKETING" DO CHECKLIST DA IMPLANTAÇÃO
 * (docs/fork/email-marketing.md).
 *
 * Sem o módulo contratado, a área é OPCIONAL e nunca vira pendência: nem todo
 * cliente compra o e-mail. Com o módulo, o que falta para a primeira campanha
 * (domínio verificado nos seis registros, remetente, rodapé completo) entra em
 * `falta`, com a ferramenta que resolve; publicar os registros no DNS é coisa
 * de quem cuida do domínio do cliente, e por isso vai em `so_pela_tela`; e
 * ligar a Amazon no servidor é de quem opera a plataforma.
 *
 * O envio de uma campanha NUNCA é pendência do implantador: é a pessoa da
 * empresa que confirma, pela tela, com a declaração da base legal.
 */
import { estadoDoModulo, lerPrecoPorEmail } from "@/lib/email-marketing/banco";
import { rotulosDoQueFalta } from "@/lib/email-marketing/dominio";

import { contarNoBanco } from "../contar";
import type { AreaDoChecklist, Pendencia, PelaTela } from "./tipos";

export const emailMarketing: AreaDoChecklist = {
  chave: "email_marketing",
  titulo: "E-mail marketing (opcional)",
  avaliar: async ({ admin }, org) => {
    const estado = await estadoDoModulo(admin, org.id);
    const [preco, campanhas, consentimentos, supressoes] = await Promise.all([
      lerPrecoPorEmail(admin, org.id),
      contarNoBanco(
        admin
          .from("mia_email_campanhas")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", org.id),
        "as campanhas de e-mail",
      ),
      contarNoBanco(
        admin
          .from("mia_email_consentimentos")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", org.id)
          .eq("tipo", "aceite"),
        "os aceites de e-mail",
      ),
      contarNoBanco(
        admin
          .from("campaign_suppressions")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", org.id)
          .eq("tipo_de_endereco", "email"),
        "a supressão de e-mail",
      ),
    ]);

    const dados = {
      opcional: !estado.contratado,
      contratado: estado.contratado,
      amazon_no_servidor: estado.amazon.configurado,
      dominio: estado.dominio
        ? {
            dominio: estado.dominio.dominio,
            verificado: estado.dominio.verificado,
            faltam: estado.dominio.faltam,
          }
        : null,
      remetente_padrao: estado.remetentePadrao
        ? `${estado.remetentePadrao.nome} <${estado.remetentePadrao.local}@…>`
        : null,
      rodape_completo: estado.rodapeCompleto,
      preco_por_email_cents: preco.cents,
      preco_padrao: preco.padrao,
      // FORK MIA (.95): de onde vem o preço (definido à mão, o plano ou o padrão).
      preco_origem: preco.origem,
      campanhas,
      aceites_registrados: consentimentos,
      enderecos_suprimidos: supressoes,
    };

    if (!estado.contratado) {
      return {
        pronto: ["E-mail marketing não contratado (opcional)."],
        falta: [],
        so_pela_tela: [],
        dados: {
          ...dados,
          como_ligar:
            "plataforma_liberar_modulo com modulo email_marketing, depois plataforma_ver_email_marketing.",
        },
      };
    }

    const pronto: string[] = ["Módulo de e-mail marketing contratado."];
    const falta: Pendencia[] = [];
    const soPelaTela: PelaTela[] = [];

    pronto.push(`Preço por e-mail: ${preco.cents} centavo(s)${preco.padrao ? " (o padrão)" : ""}.`);
    if (!estado.amazon.configurado) {
      soPelaTela.push({
        o_que: `Ligar a Amazon no servidor (faltam ${estado.amazon.falta.join(", ")})`,
        situacao: "pendente",
        tela: "Variáveis do servidor",
        caminho: "docs/fork/email-marketing.md",
        quem: "plataforma",
        por_que:
          "Sem as chaves da Amazon nenhum e-mail sai, nem o teste, e o domínio não pode ser cadastrado.",
      });
    }
    if (!estado.dominio) {
      falta.push({
        o_que: "Cadastrar o domínio de envio da empresa",
        como: "plataforma_verificar_dominio_de_email com `dominio`",
      });
    } else if (!estado.dominio.verificado) {
      soPelaTela.push({
        o_que: `Publicar no DNS de ${estado.dominio.dominio} os registros que faltam: ${rotulosDoQueFalta(estado.dominio.faltam).join(", ")}`,
        situacao: "pendente",
        tela: "E-mail marketing › Domínio",
        caminho: "/app/settings/email-marketing",
        quem: "cliente",
        por_que:
          "Os registros moram no DNS do domínio do cliente: só quem cuida dele publica. Depois, rode plataforma_verificar_dominio_de_email de novo.",
      });
    } else {
      pronto.push(`Domínio ${estado.dominio.dominio} verificado nos seis registros.`);
    }
    if (!estado.remetentePadrao)
      falta.push({
        o_que: "Cadastrar um remetente",
        como: "plataforma_configurar_email_marketing com `remetentes`",
      });
    else pronto.push(`Remetente padrão: ${estado.remetentePadrao.nome}.`);
    if (!estado.rodapeCompleto) {
      falta.push({
        o_que: "Completar o rodapé (razão social, CNPJ, endereço, motivo e privacidade)",
        como: "plataforma_configurar_email_marketing com `configuracao.rodape_*`",
      });
    } else pronto.push("Rodapé completo.");
    if (consentimentos > 0) pronto.push(`${consentimentos} aceite(s) de e-mail registrado(s).`);
    if (supressoes > 0) pronto.push(`${supressoes} endereço(s) na lista de supressão.`);
    if (campanhas > 0) pronto.push(`${campanhas} campanha(s) de e-mail.`);
    soPelaTela.push({
      o_que: "Enviar a primeira campanha",
      situacao: "opcional",
      tela: "Broadcast › E-mail",
      caminho: "/app/broadcast",
      quem: "cliente",
      por_que:
        "O MCP só monta o rascunho e manda o teste. Quem confirma o envio é uma pessoa da empresa, com a declaração da base legal.",
    });

    return { pronto, falta, so_pela_tela: soPelaTela, dados };
  },
};
