/**
 * A ÁREA "CONVERSÕES E ANÚNCIOS" DO CHECKLIST DA IMPLANTAÇÃO
 * (docs/fork/conversoes-da-meta.md).
 *
 * Três camadas, com donos diferentes:
 *
 *   a conexão        credencial da conta de anúncios do cliente: só uma pessoa
 *                    preenche, pela tela (`so_pela_tela`)
 *   as regras        o que cada etapa informa à Meta e ao Google (as réguas são
 *                    do upstream, 0436 e 0524): o agente
 *                    implantador monta (`plataforma_garantir_conversoes_da_meta`
 *                    e `_do_google`) e liga (`plataforma_ligar_conversoes`)
 *   os formulários   a chave "leads de formulário voltam para a Meta"
 *
 * ── Por que ela nunca entra em "falta" ────────────────────────────────────
 *
 * Conversão é OPCIONAL: cliente sem anúncio não tem o que informar, e a venda
 * sai sozinha quando a conexão está ligada. Se "nenhuma etapa informa a Meta"
 * contasse como falta, toda implantação terminaria com uma pendência que nem
 * sempre é de alguém. O caminho fica em `dados.como_configurar`.
 */
import { listarRegrasGoogle } from "@/lib/conversoes/regras-google";
import { lerChaveDeFormulario } from "@/lib/conversoes-meta/config";
import { listarRegrasMeta } from "@/lib/conversoes/regras-meta";

import type { AreaDoChecklist } from "./tipos";

export const conversoes: AreaDoChecklist = {
  chave: "conversoes",
  titulo: "Conversões e anúncios",
  avaliar: async ({ admin }, org) => {
    const [conexoes, regrasMeta, regrasGoogle, chave] = await Promise.all([
      admin.from("ad_platform_connections").select("platform, enabled").eq("organization_id", org.id),
      listarRegrasMeta(admin, org.id),
      listarRegrasGoogle(admin, org.id),
      lerChaveDeFormulario(admin, org.id),
    ]);
    if (conexoes.error) throw new Error(conexoes.error.message);

    const ligadas = ((conexoes.data ?? []) as Array<{ platform: string; enabled: boolean }>).filter((x) => x.enabled);
    const metaLigadas = regrasMeta.filter((r) => r.enabled).length;
    const googleLigadas = regrasGoogle.filter((r) => r.enabled).length;

    const pronto: string[] = [];
    if (regrasMeta.length > 0) {
      pronto.push(`${metaLigadas} de ${regrasMeta.length} regra(s) de etapa da Meta ligada(s).`);
    }
    if (regrasGoogle.length > 0) {
      pronto.push(`${googleLigadas} de ${regrasGoogle.length} regra(s) de etapa do Google Ads ligada(s).`);
    }
    if (chave.ligada) pronto.push("Leads de formulário da Meta voltam para a Meta.");

    return {
      pronto,
      falta: [],
      so_pela_tela: [
        {
          o_que: "Conectar o envio de conversões para a Meta e o Google (identificador do destino de conversões e token).",
          situacao: ligadas.length > 0 ? "feito" : "opcional",
          tela: "Configurações › Conversões",
          caminho: "/app/settings/conversoes",
          quem: "cliente",
          por_que: "O token de conversões é credencial da conta de anúncios do cliente.",
        },
      ],
      dados: {
        opcional: true,
        conexoes_ligadas: ligadas.map((x) => x.platform),
        regras_da_meta: { gravadas: regrasMeta.length, ligadas: metaLigadas },
        regras_do_google: { gravadas: regrasGoogle.length, ligadas: googleLigadas },
        leads_de_formulario_da_meta: chave.ligada,
        como_configurar:
          "plataforma_ver_conversoes mostra os funis, as etapas e o que já existe. plataforma_garantir_conversoes_da_meta " +
          "(com `usar_recomendado: true`) e plataforma_garantir_conversoes_do_google gravam as regras DESLIGADAS; " +
          "plataforma_ligar_conversoes as liga; plataforma_ligar_leads_de_formulario_da_meta liga a volta dos leads de formulário; " +
          "plataforma_diagnosticar_conversoes_da_meta confere se a Meta está recebendo. A venda (negócio ganho) sai sozinha com a conexão ligada.",
      },
    };
  },
};
