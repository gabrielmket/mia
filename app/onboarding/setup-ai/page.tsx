import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { lerRetratoDaInstalacao } from "@/lib/instalacao/retrato";
import { SetupAiForm } from "./_form";
import { InteligenciaDele } from "./_inteligencia";
import { capacidadesPadraoDoOnboarding } from "@/lib/ai/agents/capacidades-padrao";
import { TOOL_CATALOG } from "@/lib/mcp/tools/catalog";
import { CONFERENCIAS_DE_SAIDA } from "@/lib/ai/guardrails/lista-de-conferencia";
import { traduzir } from "@/lib/i18n/dicionario";
import { podeConfigurarChaveDeIa } from "@/lib/ai/custo-e-da-plataforma";
// FORK MIA (.91): o agente parte do modelo do segmento (lib/onboarding/modelos-de-agente-da-mia.ts).
import { loadOnboardingState } from "@/app/actions/onboarding/_shared";
import {
  modeloDoSegmento,
  nomeDoAgenteDoModelo,
  segmentoDoEstado,
  type SegmentoDoOnboarding,
} from "@/lib/onboarding/modelos-de-agente-da-mia";
import { roleAtLeast } from "@/lib/auth/types";
import { AvisoDoModelo, OQueOModeloEnsina, type ModeloNaTela } from "./_modelo";
import { RascunhoDoModelo } from "./_rascunho-do-modelo";

/** FORK MIA (.91): o modelo do segmento, do jeito que a tela mostra. */
function modeloNaTela(segmento: SegmentoDoOnboarding): ModeloNaTela {
  const m = modeloDoSegmento(segmento);
  return {
    segmento,
    rotulo: m.rotulo,
    curto: m.curto,
    nome: nomeDoAgenteDoModelo(segmento),
    jeito: m.jeito,
    regrasDeExemplo: [...m.regrasDeExemplo],
    faz: [...m.faz],
    naoFaz: [...m.naoFaz],
  };
}

/**
 * FORK MIA (.91): o agente padrão que existe em RASCUNHO porque a pessoa aprovou
 * a proposta do assistente. Lido pela sessão (gestor em diante vê a proposta).
 */
async function rascunhoDaProposta(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
): Promise<{ id: string; nome: string } | null> {
  const { data: agente } = await supabase
    .from("ai_agents")
    .select("id, name, published_version_id")
    .eq("organization_id", orgId)
    .eq("is_default", true)
    .is("archived_at", null)
    .maybeSingle();
  const a = agente as { id: string; name: string; published_version_id: string | null } | null;
  if (!a || a.published_version_id) return null;
  const { data: propostas } = await supabase
    .from("mia_assistente_propostas")
    .select("resultado")
    .eq("organization_id", orgId)
    .eq("tipo", "agente")
    .eq("situacao", "aplicada")
    .limit(10);
  const daProposta = ((propostas ?? []) as Array<{ resultado: { agente_id?: string } | null }>).some(
    (p) => p.resultado?.agente_id === a.id,
  );
  return daProposta ? { id: a.id, nome: a.name } : null;
}

export const dynamic = "force-dynamic";

/**
 * O passo que era "Configurar IA" e pedia dois campos.
 *
 * Ele é o coração da experiência: é aqui que a pessoa deixa de configurar um
 * sistema e passa a treinar alguém. Além do nome e do jeito de falar, agora
 * pergunta as REGRAS DA CASA — que vão para a memória da organização, valendo
 * para qualquer agente, e não para o prompt deste — e mostra, sem pedir
 * configuração nenhuma, o que ele já vem sabendo fazer e o que nunca vai fazer.
 *
 * As duas listas saem das MESMAS fontes que o runtime usa: as capacidades do
 * pacote que o agente recebe ligado, e as conferências que rodam antes de cada
 * mensagem sair. Escrever essas frases à mão aqui seria a tela prometendo um
 * comportamento que o código não garante.
 */
export default async function SetupAiPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/login");
  const idioma = user.idioma;

  const supabase = await createClient();
  const retrato = await lerRetratoDaInstalacao({ supabase, orgId: activeOrg.orgId });

  const porNome = new Map(TOOL_CATALOG.map((c) => [c.name, c]));
  const capacidades = capacidadesPadraoDoOnboarding()
    .map((id) => porNome.get(id)?.rotulo)
    .filter((r): r is string => Boolean(r))
    .map((r) => traduzir(r, idioma));

  const conferencias = CONFERENCIAS_DE_SAIDA.map((c) => traduzir(c.rotulo, idioma));
  const podeConfigurar = podeConfigurarChaveDeIa(user);

  // FORK MIA (.91): o modelo do segmento confirmado no passo "Seu negócio".
  const segmento = await loadOnboardingState(activeOrg.orgId)
    .then(({ state }) => segmentoDoEstado(state))
    .catch(() => null);
  const modelo = segmento ? modeloNaTela(segmento) : null;
  const rascunho = segmento ? await rascunhoDaProposta(supabase, activeOrg.orgId).catch(() => null) : null;

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">{traduzir("Treine seu funcionário", idioma)}</h2>
        <p className="text-sm text-muted-foreground">
          {traduzir("Quem ele é, como fala e o que pode prometer. Dá para mudar tudo depois.", idioma)}
        </p>
      </header>
      {/*
        O cérebro vem ANTES do resto do formulário: sem chave, nada do que a
        pessoa preencher abaixo produz um funcionário que responde. E é aqui que
        a chave passa a importar — um clique antes de ele ser criado com ela.
      */}
      {/* FORK MIA (.91): de onde o texto parte, e o link para trocar o segmento. */}
      {modelo ? <AvisoDoModelo modelo={modelo} /> : null}
      <InteligenciaDele
        podeConfigurar={podeConfigurar}
        inicial={{
          origem: retrato.inteligencia.origemDaChave,
          provedor: retrato.inteligencia.provedor,
          rotulo: retrato.inteligencia.rotulo,
          final: retrato.inteligencia.chaveDaOrg?.final ?? null,
        }}
      />

      {/*
        O MESMO predicado nos dois: o aviso de rascunho sem cérebro não pode
        mandar colar a chave num campo que `InteligenciaDele` escondeu.
      */}
      {/*
        FORK MIA (.91): com o agente já em rascunho pela proposta do assistente,
        o passo publica o rascunho aprovado em vez de criar outro.
      */}
      {rascunho ? (
        <RascunhoDoModelo agenteId={rascunho.id} nome={rascunho.nome} administra={roleAtLeast(activeOrg.role, "admin")} />
      ) : (
        <SetupAiForm capacidades={capacidades} conferencias={conferencias} podeConfigurar={podeConfigurar} modelo={modelo} />
      )}
      {modelo ? <OQueOModeloEnsina modelo={modelo} /> : null}
    </div>
  );
}
