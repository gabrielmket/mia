"use client";

/**
 * FORK MIA — a aba "Formulários de leads" de Configurações › Meta Ads.
 *
 * Até a .60 era uma tela própria (Configurações › Formulários da Meta); na .61
 * virou aba de Meta Ads, para a empresa configurar tudo da Meta num lugar só. O
 * endereço antigo redireciona para cá.
 *
 * .61 — SÓ AS PÁGINAS DA EMPRESA. A lista vem de `mia_paginas_da_meta`
 * (migration 9004), atribuída pela plataforma. Sem Página atribuída, a aba diz
 * isso e nem consulta a Meta.
 *
 * .64 — COM CONTA PRÓPRIA, A EMPRESA ESCOLHE. Quem conectou a própria conta da
 * Meta (aba Contas de anúncio) vê as Páginas que essa conta alcança e marca uma
 * ou várias (migration 9008, `lib/leads-da-meta/autoatendimento.ts`). Página
 * de outra empresa aparece travada, sem dizer de qual. Quem lê pela conexão da
 * plataforma continua como na .61. Os formulários vêm agrupados por Página.
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

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  useAssumirPagina,
  useDiagnosticoDaMeta,
  useEscolhaDasPaginas,
  useEstadoDosLeadsDaMeta,
  useLerLeadsDaMetaAgora,
  useSalvarConfigDosLeadsDaMeta,
  useSalvarFormularioDaMeta,
  useSoltarPagina,
  type ConfigDosLeadsDaMeta,
  type FormularioEscolhido,
  type LeituraDoHistorico,
  type PaginaDaEmpresa,
  type ResultadoDaLeituraAgora,
} from "@/hooks/ads/useLeadsDaMeta";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { usePipelines, usePipelineStages } from "@/hooks/webhooks/useWebhookSources";
import { ApiError } from "@/lib/api/types";
import {
  PAPEIS_DO_CAMPO,
  sugestaoPelasPerguntas,
  type PapelDoCampo,
} from "@/lib/leads-da-meta/campos-do-formulario";
import type { PaginaParaEscolher } from "@/lib/leads-da-meta/autoatendimento";
import type { Diagnostico, PaginaDiagnosticada } from "@/lib/leads-da-meta/diagnostico";
import {
  MENSAGEM_DO_MODO_DA_PLATAFORMA,
  MENSAGEM_DO_MOTIVO,
  MENSAGEM_DO_TEMPO_REAL,
  PAGINA_JA_LIGADA_A_OUTRA_EMPRESA,
  TEMPO_REAL_LIGADO,
  TEMPO_REAL_PENDENTE,
} from "@/lib/leads-da-meta/mensagens";
import type { FormularioDaPagina } from "@/lib/plataformas-de-anuncio/meta/leads";

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
  // .62: sem ela a Página não é assinada no app, e o lead só entra pela leitura.
  pages_manage_metadata: "receber os leads na hora (tempo real)",
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
  // A Meta só é consultada quando há o que perguntar: token E Página da empresa.
  const diagnostico = useDiagnosticoDaMeta(
    Boolean(dados?.conectada) && (dados?.paginas.length ?? 0) > 0,
  );

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

  // .64: com a própria conta da Meta conectada, a empresa escolhe as Páginas.
  const contaPropria = dados.origem_da_conexao === "propria";

  // .61: a Página vem antes do token. Sem Página desta empresa não há o que
  // importar, tenha o token que tiver, e mandar colar token seria a pista errada.
  // .64: com conta própria, a pista certa é a escolha, e ela vem no lugar.
  if (dados.paginas.length === 0) {
    return (
      <div className="flex max-w-5xl flex-col gap-6">
        {contaPropria ? (
          <QuadroDaEscolhaDasPaginas semPaginaAinda />
        ) : (
          <div className="rounded-md border p-6 text-sm">
            <p className="font-medium">{t("Nenhuma Página da Meta é desta empresa ainda.")}</p>
            <p className="mt-1 text-muted-foreground">
              {t(
                "Cada Página da Meta é de uma empresa só, e quem define de qual empresa é cada Página é quem administra a plataforma. Peça ao suporte para atribuir a Página desta empresa; depois disso os formulários dela aparecem aqui.",
              )}
            </p>
          </div>
        )}
        <FormulariosDeOutraEmpresa escolhidos={dados.formularios} paginas={[]} />
      </div>
    );
  }

  if (!dados.conectada) {
    return (
      <div className="rounded-md border p-6 text-sm">
        <p className="font-medium">{t("Nenhum token de anúncios conectado.")}</p>
        <p className="mt-1 text-muted-foreground">
          {t(
            "Os leads são lidos com o mesmo token da tabela de campanhas. Cole na aba Contas de anúncio um token com as permissões leads_retrieval, pages_show_list, pages_read_engagement e pages_manage_ads.",
          )}
        </p>
        <a
          className="mt-4 inline-block rounded-md border px-4 py-2 font-medium hover:bg-muted"
          href="/app/settings/meta-ads"
        >
          {t("Ir para Contas de anúncio")}
        </a>
      </div>
    );
  }

  const temFormularioAtivo = dados.formularios.some((f) => f.ativo);

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <QuadroDaChave config={dados.config} temFormularioAtivo={temFormularioAtivo} />
      {contaPropria && <QuadroDaEscolhaDasPaginas semPaginaAinda={false} />}
      <QuadroDePermissoes
        diagnostico={diagnostico.data?.data ?? null}
        carregando={diagnostico.isFetching}
        erro={diagnostico.error}
        aoConferir={() => void diagnostico.refetch()}
      />
      <QuadroDasPaginas
        diagnostico={diagnostico.data?.data ?? null}
        escolhidos={dados.formularios.filter((f) =>
          dados.paginas.some((p) => p.page_id === f.page_id),
        )}
      />
      <FormulariosDeOutraEmpresa escolhidos={dados.formularios} paginas={dados.paginas} />
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
          "Com o tempo real ligado, a Meta avisa na hora e o lead entra em segundos; a leitura automática a cada 5 minutos continua como garantia. A primeira leitura de cada formulário volta os dias escolhidos acima; a Meta guarda os leads por 90 dias.",
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

// ─── 1b. a escolha das Páginas pela conta própria (.64) ─────────────────────

/**
 * As Páginas que a conta da Meta desta empresa alcança, para marcar e desmarcar.
 * Marcar assume a Página (conferida na Meta pela rota); desmarcar solta, depois
 * de confirmar, porque desliga os formulários dela. Página de outra empresa fica
 * travada com a frase do suporte, e a Página atribuída pela plataforma também.
 */
function QuadroDaEscolhaDasPaginas({ semPaginaAinda }: { semPaginaAinda: boolean }) {
  const t = useT();
  const escolha = useEscolhaDasPaginas(true);
  const assumir = useAssumirPagina();
  const soltar = useSoltarPagina();
  const [aSoltar, setASoltar] = useState<PaginaParaEscolher | null>(null);
  const dados = escolha.data?.data ?? null;
  const ocupado = assumir.isPending || soltar.isPending;

  return (
    <section
      className="flex flex-col gap-3 rounded-md border p-4"
      aria-labelledby="titulo-escolha-das-paginas"
      data-testid="escolha-das-paginas"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="titulo-escolha-das-paginas" className="text-base font-semibold">
          {t("Páginas desta empresa")}
        </h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void escolha.refetch()}
          disabled={escolha.isFetching}
        >
          {escolha.isFetching ? t("Conferindo…") : t("Conferir de novo")}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {t(
          "Marque as Páginas da Meta de onde esta empresa importa os formulários. Aparecem as Páginas que a conta da Meta conectada aqui alcança; pode ser uma ou várias.",
        )}
      </p>

      {escolha.isLoading && (
        <p className="text-sm text-muted-foreground">{t("Lendo as Páginas na Meta…")}</p>
      )}
      {Boolean(escolha.error) && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {mensagemDeErro(escolha.error, t)}
        </p>
      )}

      {dados?.modo === "plataforma" && dados.motivo && (
        <p className="text-sm">{t(MENSAGEM_DO_MODO_DA_PLATAFORMA[dados.motivo]!)}</p>
      )}

      {dados?.erro && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {t(MENSAGEM_DO_MOTIVO[dados.erro.falha] ?? "Não consegui carregar agora.")}
        </p>
      )}

      {dados?.modo === "conta_propria" && !dados.erro && dados.paginas.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t(
            "A conta da Meta conectada não alcança nenhuma Página. No Gerenciador de Negócios, dê ao usuário do token acesso à Página (Usuários do sistema › Atribuir ativos › Páginas).",
          )}
        </p>
      )}

      {dados?.modo === "conta_propria" && dados.paginas.length > 0 && (
        <ul className="flex flex-col gap-2">
          {dados.paginas.map((pagina) => (
            <LinhaDaEscolha
              key={pagina.id}
              pagina={pagina}
              ocupado={ocupado}
              aoMarcar={() => assumir.mutate(pagina.id)}
              aoDesmarcar={() => setASoltar(pagina)}
            />
          ))}
        </ul>
      )}

      {semPaginaAinda && dados?.modo === "conta_propria" && dados.paginas.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {t("Marque uma Página para os formulários dela aparecerem aqui.")}
        </p>
      )}

      {/* .65: desconectar a conta própria solta as Páginas marcadas aqui (9009). */}
      {dados?.modo === "conta_propria" && dados.paginas.length > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="desconectar-solta-as-paginas">
          {t(
            "Se a conta da Meta desta empresa for desconectada, as Páginas marcadas aqui são desmarcadas e os formulários delas param de ser importados. Ao conectar de novo, é só marcar outra vez.",
          )}
        </p>
      )}

      <AlertDialog open={aSoltar !== null} onOpenChange={(aberto) => !aberto && setASoltar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Desmarcar esta Página?")}</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="block font-medium text-foreground">{aSoltar?.nome}</span>
              {t(
                "Os formulários desta Página param de ser importados agora. Para voltar, marque a Página de novo e ligue os formulários.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (aSoltar) soltar.mutate(aSoltar.id);
                setASoltar(null);
              }}
            >
              {t("Desmarcar")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function LinhaDaEscolha({
  pagina,
  ocupado,
  aoMarcar,
  aoDesmarcar,
}: {
  pagina: PaginaParaEscolher;
  ocupado: boolean;
  aoMarcar: () => void;
  aoDesmarcar: () => void;
}) {
  const t = useT();
  const id = `escolha-${pagina.id}`;
  const marcada = pagina.estado === "desta_empresa";
  // Só a Página livre se marca, e só a que a própria empresa assumiu se desmarca.
  const travada =
    pagina.estado === "de_outra_empresa" ||
    (marcada && pagina.origem !== "conta_propria") ||
    (!marcada && !pagina.alcancada);

  return (
    <li className="flex items-start gap-3 rounded-md border p-3">
      <input
        id={id}
        type="checkbox"
        className="mt-1 h-4 w-4 cursor-pointer disabled:cursor-not-allowed"
        checked={marcada}
        disabled={travada || ocupado}
        onChange={(e) => (e.target.checked ? aoMarcar() : aoDesmarcar())}
      />
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="cursor-pointer font-medium">
          {pagina.nome}
        </label>
        <span className="text-xs text-muted-foreground">{pagina.id}</span>
        {pagina.estado === "de_outra_empresa" && (
          <span className="text-sm text-amber-700 dark:text-amber-400">
            {t(PAGINA_JA_LIGADA_A_OUTRA_EMPRESA)}
          </span>
        )}
        {marcada && pagina.origem === "plataforma" && (
          <span className="text-sm text-muted-foreground">
            {t("Atribuída pela plataforma. Para desmarcar, fale com o suporte.")}
          </span>
        )}
        {marcada && pagina.origem !== "plataforma" && !pagina.alcancada && (
          <span className="text-sm text-muted-foreground">
            {t("A conta da Meta desta empresa não alcança mais esta Página.")}
          </span>
        )}
      </div>
    </li>
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
          {diagnostico?.origem === "plataforma"
            ? // .61: o token é o da plataforma, emprestado só para as Páginas desta
              // empresa. Quem o gera de novo é quem administra a plataforma.
              t(
                "Estas Páginas são lidas pela conexão da plataforma. Avise o suporte para gerar o token de novo com as permissões que faltam.",
              )
            : t(
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
            "Esta empresa tem mais Páginas do que esta tela lista de uma vez; aparecem as 30 primeiras.",
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
  // .64: um grupo por Página, com a borda e o título dela: com várias Páginas,
  // cada formulário fica debaixo da Página de onde vem.
  const tituloId = `pagina-${pagina.id}`;
  return (
    <section
      className="flex flex-col gap-2 rounded-md border bg-muted/20 p-3"
      aria-labelledby={tituloId}
      data-testid={`grupo-da-pagina-${pagina.id}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={tituloId} className="text-sm font-semibold">
          {pagina.nome}
        </h3>
        <span className="text-xs text-muted-foreground">
          {pagina.formularios.length}{" "}
          {pagina.formularios.length === 1 ? t("formulário") : t("formulários")}
        </span>
      </div>
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
    </section>
  );
}

/** Valor do seletor para "Automático": o Select não aceita item de valor vazio. */
const AUTOMATICO = "__automatico__";

/** O rótulo de cada papel no seletor da pergunta. */
const ROTULO_DO_PAPEL: Record<PapelDoCampo, string> = {
  telefone: "Pergunta do telefone",
  nome: "Pergunta do nome",
  email: "Pergunta do e-mail",
};

const COLUNA_DO_PAPEL = {
  telefone: "campo_telefone",
  nome: "campo_nome",
  email: "campo_email",
} as const;

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
  // .62: a pergunta de cada papel. "" = automático.
  const [campos, setCampos] = useState<Record<PapelDoCampo, string>>({
    telefone: escolhido?.campo_telefone ?? "",
    nome: escolhido?.campo_nome ?? "",
    email: escolhido?.campo_email ?? "",
  });

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

  const camposMudaram = PAPEIS_DO_CAMPO.some(
    (papel) => campos[papel] !== (escolhido?.[COLUNA_DO_PAPEL[papel]] ?? ""),
  );
  const mudou =
    !escolhido ||
    ativo !== escolhido.ativo ||
    funil !== (escolhido.pipeline_id ?? "") ||
    etapa !== (escolhido.stage_id ?? "") ||
    camposMudaram;
  const id = `form-${formulario.id}`;
  const sugestao = sugestaoPelasPerguntas(formulario.perguntas);
  const perguntas = Object.entries(formulario.perguntas);

  const salvarAgora = (ligado: boolean) =>
    salvar.mutate({
      page_id: pagina.id,
      page_name: pagina.nome,
      form_id: formulario.id,
      form_name: formulario.nome,
      perguntas: formulario.perguntas,
      pipeline_id: funil,
      stage_id: etapa,
      ativo: ligado,
      campo_telefone: campos.telefone || null,
      campo_nome: campos.nome || null,
      campo_email: campos.email || null,
    });

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

      {escolhido?.ativo && (
        <EstadoDoTempoReal
          escolhido={escolhido}
          ligando={salvar.isPending}
          aoLigar={() => salvarAgora(true)}
        />
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
          onClick={() => salvarAgora(ativo)}
        >
          {salvar.isPending ? t("Salvando…") : t("Salvar")}
        </Button>
      </div>

      {/* .62: qual pergunta é o telefone, o nome e o e-mail. O automático
          reconhece o campo padrão da Meta e a pergunta própria que fala em
          celular, telefone ou WhatsApp; aqui se corrige quando ele erra. */}
      {perguntas.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            {t("Quais perguntas são o telefone, o nome e o e-mail")}
          </summary>
          <div className="mt-2 flex flex-wrap items-start gap-3">
            {PAPEIS_DO_CAMPO.map((papel) => {
              const automatico = sugestao[papel];
              return (
                <div key={papel} className="flex flex-col gap-1.5">
                  <Label htmlFor={`${id}-${papel}`}>{t(ROTULO_DO_PAPEL[papel])}</Label>
                  <Select
                    value={campos[papel] || AUTOMATICO}
                    onValueChange={(v) =>
                      setCampos((atual) => ({ ...atual, [papel]: v === AUTOMATICO ? "" : v }))
                    }
                  >
                    <SelectTrigger id={`${id}-${papel}`} className="w-64">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={AUTOMATICO}>{t("Automático")}</SelectItem>
                      {perguntas.map(([chave, rotulo]) => (
                        <SelectItem key={chave} value={chave}>
                          {rotulo}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!campos[papel] && (
                    <span className="text-xs text-muted-foreground">
                      {automatico
                        ? `${t("O automático usa:")} ${formulario.perguntas[automatico] ?? automatico}`
                        : t("O automático não reconheceu nenhuma pergunta.")}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {t(
              "O telefone só é aceito se a resposta tiver DDD e número; senão o sistema tenta a próxima pergunta. Salve para valer nos próximos leads.",
            )}
          </p>
        </details>
      )}

      {!escolhido && (
        <p className="text-xs text-muted-foreground">
          {t('Ligue "Importar este formulário", confira o destino e salve.')}
        </p>
      )}
    </div>
  );
}

/**
 * .62 — o aviso em tempo real deste formulário: ligado, recusado (com o motivo
 * e o que fazer) ou ainda não conferido. A recusa não para a importação: a
 * leitura a cada 5 minutos continua, e a frase diz isso.
 */
function EstadoDoTempoReal({
  escolhido,
  ligando,
  aoLigar,
}: {
  escolhido: FormularioEscolhido;
  ligando: boolean;
  aoLigar: () => void;
}) {
  const t = useT();
  const tag = useTagDeIdioma();

  if (escolhido.tempo_real === "assinado") {
    return (
      <p className="text-sm text-emerald-700 dark:text-emerald-400">
        {t(TEMPO_REAL_LIGADO)}
        {escolhido.ultimo_aviso_da_meta_em && (
          <span className="block text-xs text-muted-foreground">
            {t("Último lead pelo aviso da Meta:")}{" "}
            {new Date(escolhido.ultimo_aviso_da_meta_em).toLocaleString(tag)}
          </span>
        )}
      </p>
    );
  }

  const motivoDoTempoReal = escolhido.tempo_real_motivo ?? "";
  const frase =
    escolhido.tempo_real !== "recusado"
      ? t(TEMPO_REAL_PENDENTE)
      : MENSAGEM_DO_TEMPO_REAL[motivoDoTempoReal]
        ? t(MENSAGEM_DO_TEMPO_REAL[motivoDoTempoReal])
        : t(MENSAGEM_DO_TEMPO_REAL.transitorio!);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm">
      <p className="flex-1">{frase}</p>
      <Button variant="outline" size="sm" disabled={ligando} onClick={aoLigar}>
        {ligando ? t("Ligando…") : t("Ligar o tempo real")}
      </Button>
    </div>
  );
}

// ─── 3b. o que ficou de Página que não é desta empresa ─────────────────────

/**
 * Formulários escolhidos numa Página que não é (ou deixou de ser) desta empresa.
 * O banco já os desligou (9004) e a Página não aparece mais no quadro de cima;
 * sem este aviso eles sumiriam da tela calados, e quem os configurou ficaria
 * esperando lead que não vem.
 */
function FormulariosDeOutraEmpresa({
  escolhidos,
  paginas,
}: {
  escolhidos: FormularioEscolhido[];
  paginas: PaginaDaEmpresa[];
}) {
  const t = useT();
  const daEmpresa = new Set(paginas.map((p) => p.page_id));
  const alheios = escolhidos.filter((f) => !daEmpresa.has(f.page_id));
  if (alheios.length === 0) return null;
  // .64: a Página que a própria empresa desmarcou (9008) não é "de outra
  // empresa", e a frase diz como voltar a importar.
  const desmarcados = alheios.filter((f) => f.ultimo_motivo === "pagina_solta");
  const deOutra = alheios.filter((f) => f.ultimo_motivo !== "pagina_solta");
  const lista = (forms: FormularioEscolhido[]) => (
    <ul className="mt-1 list-disc pl-5">
      {forms.map((f) => (
        <li key={f.id}>
          {f.form_name ?? f.form_id} ({f.page_name ?? f.page_id})
        </li>
      ))}
    </ul>
  );
  return (
    <>
      {desmarcados.length > 0 && (
        <div className="rounded-md border p-3 text-sm">
          <p className="font-medium">{t("Formulários de Páginas desmarcadas por esta empresa:")}</p>
          {lista(desmarcados)}
          <p className="mt-1 text-muted-foreground">{t(MENSAGEM_DO_MOTIVO.pagina_solta!)}</p>
        </div>
      )}
      {deOutra.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">{t("Formulários de Páginas que não são desta empresa:")}</p>
          {lista(deOutra)}
          <p className="mt-1">{t(MENSAGEM_DO_MOTIVO.pagina_nao_e_da_empresa!)}</p>
        </div>
      )}
    </>
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
