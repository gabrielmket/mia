import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { ehChaveDoPainel, FONTES, type Fonte } from "@/lib/paineis/catalogo";
import { podeCompartilhar, podeEditar, podeExportar, podeVerAnuncios, veValores } from "@/lib/relatorios/acesso";
import { FONTES_DO_MONTADOR } from "@/lib/relatorios/catalogo";
import { configPadrao } from "@/lib/relatorios/config";
import { nomeDoPronto, relatorioPronto } from "@/lib/relatorios/prontos";
import { funisDosRelatorios, lerRelatorio } from "@/lib/relatorios/servidor";
import { createClient } from "@/lib/supabase/server";

import { EditorDeRelatorio, type InicioDoEditor } from "./_editor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Editor de relatório" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * FORK MIA (item 9) — O EDITOR DE RELATÓRIO (protótipo, tela 3).
 *
 * Abre de três jeitos, pela URL: `?id=<relatório salvo>`, `?pronto=<chave>`
 * (um dos doze prontos: mexer e salvar vira cópia, o original não muda) ou
 * `?fonte=<fonte>` (novo, com a conta padrão da fonte). A configuração mora no
 * cliente; a prévia é calculada no banco a cada mudança e a cada 5 minutos.
 */
export default async function EditorPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; pronto?: string; fonte?: string }>;
}) {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const t = (texto: string) => traduzir(texto, user.idioma);
  const busca = await searchParams;
  const db = await createClient();
  const { funis, padrao } = await funisDosRelatorios(db, activeOrg.orgId);
  const role = activeOrg.role;

  let inicio: InicioDoEditor;
  if (busca.id && UUID.test(busca.id)) {
    const r = await lerRelatorio(db, activeOrg.orgId, busca.id);
    if (!r) redirect("/app/relatorios");
    const edita = podeEditar(r, { userId: user.id, role });
    inicio = {
      origem: edita ? "meu" : "alheio",
      relatorioId: r.id,
      pronto: r.prontoDe,
      nome: r.nome,
      config: r.config,
      compartilhado: r.compartilhado,
      meu: r.criadoPor === user.id,
    };
  } else if (busca.pronto && ehChaveDoPainel(busca.pronto)) {
    const p = relatorioPronto(busca.pronto)!;
    inicio = {
      origem: "pronto",
      relatorioId: null,
      pronto: p.chave,
      nome: nomeDoPronto(p, padrao?.compromissos, t),
      config: p.config,
      compartilhado: false,
      meu: false,
    };
  } else if (busca.fonte && (FONTES as readonly string[]).includes(busca.fonte)) {
    const fonte = busca.fonte as Fonte;
    if (fonte === "anuncios" && !podeVerAnuncios(role)) redirect("/app/relatorios/novo");
    inicio = {
      origem: "novo",
      relatorioId: null,
      pronto: null,
      nome: `${t("Novo relatório de")} ${t(FONTES_DO_MONTADOR[fonte].varios)}`,
      config: configPadrao(fonte),
      compartilhado: false,
      meu: true,
    };
  } else {
    redirect("/app/relatorios/novo");
  }

  return (
    <EditorDeRelatorio
      inicio={inicio}
      funis={funis}
      funilPadrao={padrao}
      permissoes={{
        compartilhar: podeCompartilhar(role),
        exportar: podeExportar(role),
        anuncios: podeVerAnuncios(role),
        valores: veValores(role),
      }}
    />
  );
}
