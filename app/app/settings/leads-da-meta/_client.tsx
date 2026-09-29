"use client";

/**
 * FORK MIA — o corpo de Configurações › Formulários da Meta.
 *
 * Quatro quadros, na ordem em que quem configura pela primeira vez precisa deles:
 *
 *   1. a CHAVE da empresa (ligar, dias de recuperação, "Ler agora");
 *   2. as PERMISSÕES do token — o erro nº 1 desta integração é o token sem
 *      `leads_retrieval`, e ele só apareceria longe daqui, como "não chegou lead";
 *   3. as PÁGINAS e os formulários de cada uma, com o destino (funil e etapa);
 *   4. o HISTÓRICO de leituras: sucesso, sem novos, ou erro com o que fazer.
 *
 * Toda falha aparece com FRASE, e a frase diz a ação (mesma regra da tela de
 * Meta Ads): token vencido, permissão faltando, Página sem acesso e cota da Meta
 * pedem coisas diferentes de quem lê.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  useDiagnosticoDaMeta,
  useEstadoDosLeadsDaMeta,
  useLerLeadsDaMetaAgora,
  useSalvarConfigDosLeadsDaMeta,
  useSalvarFormularioDaMeta,
  type ConfigDosLeadsDaMeta,
  type FormularioEscolhido,
  type LeituraDoHistorico,
  type ResultadoDaLeituraAgora,
} from "@/hooks/ads/useLeadsDaMeta";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { usePipelines, usePipelineStages } from "@/hooks/webhooks/useWebhookSources";
import { ApiError } from "@/lib/api/types";
import type { Diagnostico, PaginaDiagnosticada } from "@/lib/leads-da-meta/diagnostico";
import type { FormularioDaPagina } from "@/lib/plataformas-de-anuncio/meta/leads";

/** O que cada motivo do histórico pede de quem lê. Chave = código gravado no banco. */
const MENSAGEM_DO_MOTIVO: Record<string, string> = {
  sem_conexao: "Nenhum token de anúncios conectado. Cole o token em Configurações › Meta Ads.",
  cifra_indisponivel:
    "A chave de criptografia do servidor não está disponível para ler o token. É configuração do servidor.",
  token_invalido:
    "A Meta recusou o token: ele expirou ou foi revogado. Gere um novo no Gerenciador de Negócios e cole em Configurações › Meta Ads.",
  permissao_insuficiente:
    "O token não tem permissão para ler os leads deste formulário. Confira as permissões acima e, no Gerenciador de Negócios, o Acesso a leads da Página.",
  limite_de_chamadas:
    "A Meta limitou as chamadas por excesso de consultas. A próxima leitura tenta de novo sozinha.",
  campo_invalido:
    "A Meta recusou um campo da consulta. É problema do sistema, não da sua conta: avise quem mantém a instalação.",
  transitorio: "Não foi possível falar com a Meta agora. A próxima leitura tenta de novo sozinha.",
  pagina_nao_atribuida:
    "A Página deste formulário não está atribuída ao usuário do sistema do token. Atribua a Página no Gerenciador de Negócios.",
  sem_token_da_pagina:
    "O usuário do sistema não tem acesso suficiente à Página. Dê a ele acesso de anúncios e de leads (ou controle total) no Gerenciador de Negócios.",
  sem_funil:
    "O funil ou a etapa de destino deste formulário não existe mais. Escolha outro destino e salve.",
  volume_acima_do_limite:
    "Chegaram mais leads do que uma leitura comporta e a leitura ficou incompleta. Avise quem mantém a instalação.",
  erro_ao_gravar:
    "Os leads chegaram, mas a gravação parou no meio. A próxima leitura tenta de novo sozinha.",
  sem_origem_do_anuncio:
    "A Meta não devolveu a origem do anúncio (campanha, conjunto e anúncio) destes leads. Eles entraram mesmo assim. Para ter a origem, gere o token de novo com a permissão ads_management.",
  recuperacao_cortada:
    "Parte do período pedido tem mais de 90 dias, e a Meta não guarda leads tão antigos.",
};

const ROTULO_DO_STATUS: Record<string, string> = {
  sucesso: "Leads recebidos",
  sem_novos: "Sem leads novos",
  erro: "Erro",
};

const TOM_DO_STATUS: Record<string, string> = {
  sucesso: "text-emerald-600 dark:text-emerald-400",
  sem_novos: "text-muted-foreground",
  erro: "text-red-600 dark:text-red-400",
};

/** Para quê serve cada permissão — a tela diz o efeito de faltar, não só o nome. */
const USO_DA_PERMISSAO: Record<string, string> = {
  leads_retrieval: "ler os leads",
  pages_show_list: "listar as Páginas",
  pages_read_engagement: "ler os dados da Página",
  pages_manage_ads: "listar os formulários e ler os leads com os dados do anúncio",
  ads_management: "trazer a origem do anúncio de cada lead",
  ads_read: "a tabela de campanhas em Análise › Meta Ads",
};

function mensagemDeErro(erro: unknown, t: (s: string) => string): string {
  if (erro instanceof ApiError) {
    const porCodigo: Record<string, string> = {
      ads_token_invalido: MENSAGEM_DO_MOTIVO.token_invalido!,
      ads_sem_conexao: MENSAGEM_DO_MOTIVO.sem_conexao!,
      ads_cifra_indisponivel: MENSAGEM_DO_MOTIVO.cifra_indisponivel!,
      forbidden: "Você não tem acesso a esta configuração.",
    };
    return t(porCodigo[erro.code] ?? erro.message ?? "Não consegui carregar agora.");
  }
  return t("Não consegui carregar agora.");
}

export function LeadsDaMetaClient() {
  const t = useT();
  const estado = useEstadoDosLeadsDaMeta();
  const dados = estado.data?.data;
  const diagnostico = useDiagnosticoDaMeta(Boolean(dados?.conectada));

  if (estado.isLoading) {
    return <p className="text-sm text-muted-foreground">{t("Carregando…")}</p>;
  }
  if (estado.error || !dados) {
    return (
      <div role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm">
        {mensagemDeErro(estado.error, t)}
      </div>
    );
  }

  if (!dados.conectada) {
    return (
      <div className="rounded-md border p-6 text-sm">
        <p className="font-medium">{t("Nenhum token de anúncios conectado.")}</p>
        <p className="mt-1 text-muted-foreground">
          {t(
            "Os leads são lidos com o mesmo token da tabela de campanhas. Cole em Configurações › Meta Ads um token com as permissões leads_retrieval, pages_show_list, pages_read_engagement e pages_manage_ads.",
          )}
        </p>
        <a
          className="mt-4 inline-block rounded-md border px-4 py-2 font-medium hover:bg-muted"
          href="/app/settings/meta-ads"
        >
          {t("Ir para Configurações › Meta Ads")}
        </a>
      </div>
    );
  }

  const temFormularioAtivo = dados.formularios.some((f) => f.ativo);

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <QuadroDaChave config={dados.config} temFormularioAtivo={temFormularioAtivo} />
      <QuadroDePermissoes
        diagnostico={diagnostico.data?.data ?? null}
        carregando={diagnostico.isFetching}
        erro={diagnostico.error}
        aoConferir={() => void diagnostico.refetch()}
      />
      <QuadroDasPaginas
        diagnostico={diagnostico.data?.data ?? null}
        escolhidos={dados.formularios}
      />
      <HistoricoDeLeituras leituras={dados.leituras} formularios={dados.formularios} />
    </div>
  );
}

// ─── 1. a chave ─────────────────────────────────────────────────────────────

function QuadroDaChave({
  config,
  temFormularioAtivo,
}: {
  config: ConfigDosLeadsDaMeta;
  temFormularioAtivo: boolean;
}) {
  const t = useT();
  const tag = useTagDeIdioma();
  const salvar = useSalvarConfigDosLeadsDaMeta();
  const lerAgora = useLerLeadsDaMetaAgora();
  const [dias, setDias] = useState<string>(String(config.dias_de_recuperacao));
  const [resultado, setResultado] = useState<ResultadoDaLeituraAgora | null>(null);

  const diasValidos = /^\d+$/.test(dias) && Number(dias) >= 0 && Number(dias) <= 90;

  return (
    <section className="flex flex-col gap-4 rounded-md border p-4" aria-labelledby="titulo-chave">
      <h2 id="titulo-chave" className="text-base font-semibold">
        {t("Importação")}
      </h2>

      <div className="flex items-center gap-3">
        <Switch
          id="leads-da-meta-ativo"
          checked={config.ativo}
          disabled={salvar.isPending}
          onCheckedChange={(ligado) => salvar.mutate({ ativo: ligado })}
        />
        <Label htmlFor="leads-da-meta-ativo" className="cursor-pointer">
          {t("Importar os leads dos formulários")}
        </Label>
        {config.ativo && config.ativado_em && (
          <span className="text-xs text-muted-foreground">
            {t("ligada em")} {new Date(config.ativado_em).toLocaleString(tag)}
          </span>
        )}
      </div>

      {config.ativo && !temFormularioAtivo && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          {t(
            "A importação está ligada, mas nenhum formulário foi escolhido. Escolha abaixo quais importar.",
          )}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="leads-da-meta-dias">
            {t("Dias para trás na primeira leitura (0 a 90)")}
          </Label>
          <Input
            id="leads-da-meta-dias"
            inputMode="numeric"
            className="w-28"
            value={dias}
            onChange={(e) => setDias(e.target.value)}
            aria-invalid={!diasValidos}
          />
        </div>
        <Button
          variant="outline"
          disabled={!diasValidos || salvar.isPending || Number(dias) === config.dias_de_recuperacao}
          onClick={() => salvar.mutate({ dias_de_recuperacao: Number(dias) })}
        >
          {t("Salvar")}
        </Button>
        <Button
          disabled={!config.ativo || !temFormularioAtivo || lerAgora.isPending}
          onClick={() => lerAgora.mutate(undefined, { onSuccess: (r) => setResultado(r.data) })}
        >
          {lerAgora.isPending ? t("Lendo…") : t("Ler agora")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {t(
          "A leitura automática roda a cada 5 minutos. A primeira leitura de cada formulário volta os dias escolhidos acima; a Meta guarda os leads por 90 dias.",
        )}
      </p>
      <p aria-live="polite" className="text-sm">
        {resultado && (
          <>
            {t("Leitura concluída")}: {resultado.novos} {t("novos")} · {resultado.repetidos}{" "}
            {t("repetidos")} · {resultado.recusados} {t("recusados")} · {resultado.erros}{" "}
            {t("com erro")}
          </>
        )}
      </p>
    </section>
  );
}

// ─── 2. as permissões ───────────────────────────────────────────────────────

function QuadroDePermissoes({
  diagnostico,
  carregando,
  erro,
  aoConferir,
}: {
  diagnostico: Diagnostico | null;
  carregando: boolean;
  erro: unknown;
  aoConferir: () => void;
}) {
  const t = useT();
  const p = diagnostico?.permissoes;

  return (
    <section
      className="flex flex-col gap-3 rounded-md border p-4"
      aria-labelledby="titulo-permissoes"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="titulo-permissoes" className="text-base font-semibold">
          {t("Permissões do token")}
        </h2>
        <Button variant="outline" size="sm" onClick={aoConferir} disabled={carregando}>
          {carregando ? t("Conferindo…") : t("Conferir de novo")}
        </Button>
      </div>

      {Boolean(erro) && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {mensagemDeErro(erro, t)}
        </p>
      )}

      {p && !p.verificadas && (
        <p className="text-sm text-muted-foreground">
          {t(
            "A Meta não informou as permissões deste token. A leitura dos formulários abaixo mostra se ele alcança os leads.",
          )}
        </p>
      )}

      {p?.verificadas && p.faltandoObrigatorias.length === 0 && (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">
          {t("O token tem as permissões para ler os leads.")}
        </p>
      )}

      {p?.verificadas && p.faltandoObrigatorias.length > 0 && (
        <div role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">
          <p className="font-medium">
            {t("Faltam permissões no token, e sem elas nenhum lead é lido:")}
          </p>
          <ul className="mt-1 list-disc pl-5">
            {p.faltandoObrigatorias.map((nome) => (
              <li key={nome}>
                <code>{nome}</code> · {t(USO_DA_PERMISSAO[nome] ?? nome)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {p?.verificadas && p.faltandoRecomendadas.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">{t("Recomendadas, e ainda não concedidas:")}</p>
          <ul className="mt-1 list-disc pl-5">
            {p.faltandoRecomendadas.map((nome) => (
              <li key={nome}>
                <code>{nome}</code> · {t(USO_DA_PERMISSAO[nome] ?? nome)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {p?.verificadas && p.faltandoObrigatorias.length + p.faltandoRecomendadas.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {t(
            "Para resolver: Gerenciador de Negócios › Configurações do negócio › Usuários do sistema › o usuário do token › Gerar novo token. Marque as permissões que faltam e cole o token novo em Configurações › Meta Ads.",
          )}
        </p>
      )}
    </section>
  );
}

// ─── 3. as Páginas e os formulários ─────────────────────────────────────────

function QuadroDasPaginas({
  diagnostico,
  escolhidos,
}: {
  diagnostico: Diagnostico | null;
  escolhidos: FormularioEscolhido[];
}) {
  const t = useT();
  const porForm = new Map(escolhidos.map((f) => [f.form_id, f]));
  const alcancados = new Set(
    diagnostico?.paginas.flatMap((p) => p.formularios.map((f) => f.id)) ?? [],
  );
  const foraDoAlcance = diagnostico ? escolhidos.filter((f) => !alcancados.has(f.form_id)) : [];

  return (
    <section className="flex flex-col gap-4 rounded-md border p-4" aria-labelledby="titulo-paginas">
      <h2 id="titulo-paginas" className="text-base font-semibold">
        {t("Páginas e formulários")}
      </h2>

      {!diagnostico && (
        <p className="text-sm text-muted-foreground">{t("Lendo as Páginas na Meta…")}</p>
      )}

      {diagnostico?.erro && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {t(MENSAGEM_DO_MOTIVO[diagnostico.erro.falha] ?? "Não consegui carregar agora.")}
        </p>
      )}

      {diagnostico && !diagnostico.erro && diagnostico.paginas.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t(
            "O token não alcança nenhuma Página. No Gerenciador de Negócios, atribua a Página ao usuário do sistema do token (Usuários do sistema › Atribuir ativos › Páginas).",
          )}
        </p>
      )}

      {diagnostico?.paginas.map((pagina) => (
        <BlocoDaPagina key={pagina.id} pagina={pagina} porForm={porForm} />
      ))}

      {diagnostico?.paginasCortadas && (
        <p className="text-xs text-muted-foreground">
          {t(
            "O token alcança mais Páginas do que esta tela lista de uma vez; aparecem as 30 primeiras.",
          )}
        </p>
      )}

      {foraDoAlcance.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">{t("Formulários escolhidos que o token não alcança mais:")}</p>
          <ul className="mt-1 list-disc pl-5">
            {foraDoAlcance.map((f) => (
              <li key={f.id}>
                {f.form_name ?? f.form_id} ({f.page_name ?? f.page_id})
              </li>
            ))}
          </ul>
          <p className="mt-1">{t(MENSAGEM_DO_MOTIVO.pagina_nao_atribuida!)}</p>
        </div>
      )}
    </section>
  );
}

function BlocoDaPagina({
  pagina,
  porForm,
}: {
  pagina: PaginaDiagnosticada;
  porForm: Map<string, FormularioEscolhido>;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{pagina.nome}</h3>
      {pagina.erro && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {t(MENSAGEM_DO_MOTIVO[pagina.erro] ?? "Não consegui carregar agora.")}
        </p>
      )}
      {!pagina.erro && pagina.formularios.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t("Esta Página não tem formulários de cadastro.")}
        </p>
      )}
      {pagina.formularios.map((formulario) => (
        <LinhaDoFormulario
          key={formulario.id}
          pagina={pagina}
          formulario={formulario}
          escolhido={porForm.get(formulario.id) ?? null}
        />
      ))}
    </div>
  );
}

function LinhaDoFormulario({
  pagina,
  formulario,
  escolhido,
}: {
  pagina: PaginaDiagnosticada;
  formulario: FormularioDaPagina;
  escolhido: FormularioEscolhido | null;
}) {
  const t = useT();
  const tag = useTagDeIdioma();
  const salvar = useSalvarFormularioDaMeta();
  const funis = usePipelines();
  const listaDeFunis = funis.data?.data ?? [];

  const [ativo, setAtivo] = useState<boolean>(escolhido?.ativo ?? false);
  const [funilEscolhido, setFunil] = useState<string>(escolhido?.pipeline_id ?? "");
  const [etapaEscolhida, setEtapa] = useState<string>(escolhido?.stage_id ?? "");

  // Sem escolha ainda: o funil padrão da empresa e a primeira etapa dele. Derivado,
  // não gravado em estado — a lista chega depois da primeira pintura.
  const funil =
    funilEscolhido || listaDeFunis.find((f) => f.is_default)?.id || listaDeFunis[0]?.id || "";
  const etapas = usePipelineStages(funil || null);
  const listaDeEtapas = etapas.data?.data.stages ?? [];
  const etapa =
    etapaEscolhida && listaDeEtapas.some((e) => e.id === etapaEscolhida)
      ? etapaEscolhida
      : (listaDeEtapas[0]?.id ?? "");

  const mudou =
    !escolhido ||
    ativo !== escolhido.ativo ||
    funil !== (escolhido.pipeline_id ?? "") ||
    etapa !== (escolhido.stage_id ?? "");
  const id = `form-${formulario.id}`;

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{formulario.nome}</p>
          <p className="text-xs text-muted-foreground">
            {formulario.status === "ARCHIVED" ? t("Arquivado na Meta") : t("Ativo na Meta")}
          </p>
        </div>
        {escolhido && (
          <p className="text-xs">
            <span
              className={TOM_DO_STATUS[escolhido.ultimo_status ?? ""] ?? "text-muted-foreground"}
            >
              {escolhido.ultimo_status
                ? t(ROTULO_DO_STATUS[escolhido.ultimo_status] ?? escolhido.ultimo_status)
                : t("Ainda não lido")}
            </span>
            {escolhido.ultima_leitura_em && (
              <> · {new Date(escolhido.ultima_leitura_em).toLocaleString(tag)}</>
            )}{" "}
            · {escolhido.importados_total} {t("importados")}
          </p>
        )}
      </div>

      {escolhido?.ultimo_status === "erro" && escolhido.ultimo_motivo && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {t(MENSAGEM_DO_MOTIVO[escolhido.ultimo_motivo] ?? "Não consegui carregar agora.")}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2">
          <Switch id={`${id}-ativo`} checked={ativo} onCheckedChange={setAtivo} />
          <Label htmlFor={`${id}-ativo`} className="cursor-pointer">
            {t("Importar este formulário")}
          </Label>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-funil`}>{t("Funil")}</Label>
          <Select
            value={funil}
            onValueChange={(v) => {
              setFunil(v);
              setEtapa("");
            }}
            disabled={listaDeFunis.length === 0}
          >
            <SelectTrigger id={`${id}-funil`} className="w-56">
              <SelectValue placeholder={t("Escolha o funil")} />
            </SelectTrigger>
            <SelectContent>
              {listaDeFunis.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-etapa`}>{t("Etapa")}</Label>
          <Select value={etapa} onValueChange={setEtapa} disabled={listaDeEtapas.length === 0}>
            <SelectTrigger id={`${id}-etapa`} className="w-56">
              <SelectValue placeholder={t("Escolha a etapa")} />
            </SelectTrigger>
            <SelectContent>
              {listaDeEtapas.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          disabled={!mudou || !funil || !etapa || salvar.isPending}
          onClick={() =>
            salvar.mutate({
              page_id: pagina.id,
              page_name: pagina.nome,
              form_id: formulario.id,
              form_name: formulario.nome,
              perguntas: formulario.perguntas,
              pipeline_id: funil,
              stage_id: etapa,
              ativo,
            })
          }
        >
          {salvar.isPending ? t("Salvando…") : t("Salvar")}
        </Button>
      </div>
      {!escolhido && (
        <p className="text-xs text-muted-foreground">
          {t('Ligue "Importar este formulário", confira o destino e salve.')}
        </p>
      )}
    </div>
  );
}

// ─── 4. o histórico ─────────────────────────────────────────────────────────

function HistoricoDeLeituras({
  leituras,
  formularios,
}: {
  leituras: LeituraDoHistorico[];
  formularios: FormularioEscolhido[];
}) {
  const t = useT();
  const tag = useTagDeIdioma();
  const nomes = new Map(formularios.map((f) => [f.id, f.form_name ?? f.form_id]));

  return (
    <section
      className="flex flex-col gap-3 rounded-md border p-4"
      aria-labelledby="titulo-historico"
    >
      <h2 id="titulo-historico" className="text-base font-semibold">
        {t("Histórico de leituras")}
      </h2>
      {leituras.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t(
            "Nenhuma leitura ainda. Com a importação ligada e um formulário escolhido, a primeira acontece em até 5 minutos, ou agora pelo botão Ler agora.",
          )}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">{t("Quando")}</th>
                <th className="py-2 pr-3 font-medium">{t("Formulário")}</th>
                <th className="py-2 pr-3 font-medium">{t("Resultado")}</th>
                <th className="py-2 font-medium">{t("O que aconteceu")}</th>
              </tr>
            </thead>
            <tbody>
              {leituras.map((l) => (
                <tr key={l.id} className="border-b align-top last:border-0">
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {new Date(l.terminada_em).toLocaleString(tag)}
                    {l.repeticoes > 1 && (
                      <span className="block text-xs text-muted-foreground">
                        {l.repeticoes} {t("leituras seguidas desde")}{" "}
                        {new Date(l.iniciada_em).toLocaleString(tag)}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3">{nomes.get(l.formulario_id) ?? "—"}</td>
                  <td className="py-2 pr-3">
                    <span className={TOM_DO_STATUS[l.status] ?? ""}>
                      {t(ROTULO_DO_STATUS[l.status] ?? l.status)}
                    </span>
                    {l.status !== "sem_novos" && (
                      <span className="block text-xs text-muted-foreground">
                        {l.novos} {t("novos")} · {l.repetidos} {t("repetidos")} · {l.recusados}{" "}
                        {t("recusados")}
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-muted-foreground">
                    {l.motivo ? t(MENSAGEM_DO_MOTIVO[l.motivo] ?? l.motivo) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
