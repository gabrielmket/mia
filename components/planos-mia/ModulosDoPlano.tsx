import { Card } from "@/components/ui/card";
import { formatadorDeData } from "@/lib/cobranca/fuso";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";
import { ROTULO_DO_MODULO_DO_PLANO } from "@/lib/planos-mia/catalogo";
import { rotuloDaOrigem } from "@/lib/planos-mia/modulos";
import type { ModuloNoPainel } from "@/lib/planos-mia/painel-da-empresa";

/**
 * FORK MIA (.90) — os módulos no Plano e cobrança (protótipo, tela 4, bloco
 * Módulos): o que está ligado e por quê, o que sai numa descida agendada, o que
 * entra quando o ajuste do upgrade for pago e em qual plano vem o que falta.
 * Desenhado pelo servidor, no idioma de quem abriu.
 */
export function ModulosDoPlano({ modulos, idioma, fuso }: { modulos: readonly ModuloNoPainel[]; idioma: Idioma; fuso: string | null }) {
  const t = (s: string) => traduzir(s, idioma);
  const data = formatadorDeData(idioma, fuso, { dateStyle: "short" });
  return (
    <Card className="max-w-xl space-y-3 p-6" data-modulos-do-plano>
      <h2 className="text-sm font-semibold">{t("Módulos")}</h2>
      <ul className="space-y-3">
        {modulos.map((m) => {
          let situacao: string;
          if (m.ligado && m.sai_em) situacao = t("sai em {data}").replace("{data}", data.format(new Date(m.sai_em)));
          else if (m.ligado) situacao = t("ligado {origem}").replace("{origem}", t(rotuloDaOrigem(m)));
          else if (m.entra_ao_pagar) situacao = t("entra quando o ajuste for pago");
          else if (m.em_qual_plano) situacao = t("no plano {plano}").replace("{plano}", m.em_qual_plano);
          else situacao = t("fora do plano");
          return (
            <li key={m.modulo} className="flex items-start justify-between gap-3 text-sm" data-modulo={m.modulo} data-ligado={m.ligado}>
              <span className="min-w-0">
                <span className="block font-medium">{t(ROTULO_DO_MODULO_DO_PLANO[m.modulo].rotulo)}</span>
                <span className="block text-xs text-muted-foreground">
                  {t(ROTULO_DO_MODULO_DO_PLANO[m.modulo].descricao)}
                  {m.desligado_na_instalacao ? ` ${t("Exige o módulo da instalação ligado.")}` : ""}
                </span>
              </span>
              <span className={`shrink-0 text-xs ${m.ligado ? "font-medium" : "text-muted-foreground"}`}>{situacao}</span>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        {t(
          "Em todos os planos: atendimento com IA, CRM, agenda, follow-up, passagem para a equipe, leads da Meta, conversões, relatórios e o assistente. Desligar um módulo esconde a tela e para o envio; os dados ficam.",
        )}
      </p>
    </Card>
  );
}
