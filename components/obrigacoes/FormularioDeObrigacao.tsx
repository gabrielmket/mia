"use client";

/**
 * FORK MIA — o formulário de ADICIONAR um documento ou uma atividade recorrente.
 *
 * O TIPO preenche os padrões (validade, recorrência, avisos, quem entrega e a
 * quem se liga) e tudo pode ser mudado antes de salvar. A SITUAÇÃO aparece ao
 * vivo, calculada pelas datas digitadas, pela mesma função que o resto do
 * sistema usa: ninguém a escolhe.
 *
 * Os tipos oferecidos são os do catálogo do funil (e os da empresa inteira) e,
 * como ponto de partida, os modelos por segmento que o produto traz. "Outro"
 * abre o nome livre.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { SeletorDeContato } from "@/components/kanban/SeletorDeContato";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";
import { useAcoesDeObrigacao, useTiposDeObrigacao, type NovaObrigacao } from "@/hooks/obrigacoes/useObrigacoes";
import { useEmpresas } from "@/hooks/useEmpresas";
import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";
import {
  ROTULO_DO_SEGMENTO_DE_OBRIGACAO,
  SEGMENTOS_DE_OBRIGACAO,
  ehTipoSensivel,
  type ModeloDeTipo,
} from "@/lib/obrigacoes/catalogo";
import { datasAoAdicionar } from "@/lib/obrigacoes/ciclo";
import { comoDia, somarMeses, type Dia } from "@/lib/obrigacoes/datas";
import type { ContextoDoEscopo } from "@/lib/obrigacoes/leitura";
import { ROTULO_DA_SITUACAO, mesesDaRecorrencia, situacao, textoDaSituacao, tomDaSituacao } from "@/lib/obrigacoes/situacao";
import {
  AVISOS_PADRAO,
  DIAS_SEM_RESPOSTA_PADRAO,
  ROTULO_DA_CATEGORIA,
  ROTULO_DA_RECORRENCIA,
  ROTULO_DE_QUEM_ENTREGA,
  RECORRENCIAS,
  normalizarAvisos,
  type Categoria,
  type ItemParaSituacao,
  type LigaA,
  type QuemEntrega,
  type Recorrencia,
  type TipoDeObrigacao,
} from "@/lib/obrigacoes/tipos";
import type { Contact } from "@/lib/types/contacts";
import { cn } from "@/lib/utils";

const OUTRO = "outro";

/** O que o tipo escolhido traz: do catálogo da empresa ou de um modelo. */
type Padroes = Pick<
  TipoDeObrigacao,
  "nome" | "nome_curto" | "categoria" | "quem_entrega" | "recorrencia" | "recorrencia_meses" | "validade_meses" | "avisos_dias" | "dias_sem_resposta" | "liga_a"
> & { id: string | null };

interface Rascunho {
  escolha: string;
  nomeLivre: string;
  categoria: Categoria;
  quem: QuemEntrega;
  recorrencia: Recorrencia;
  meses: string;
  validadeMeses: string;
  avisos: [string, string, string];
  semResposta: string;
  responsavel: string;
  observacao: string;
  pedido: string;
  prazo: string;
  recebido: string;
  validade: string;
  proxima: string;
  noNegocio: boolean;
  naEmpresa: boolean;
  noContato: boolean;
  /** Só no escopo de empresa ou da lista: qual contato. */
  contatoId: string;
  empresaId: string;
}

const COR_DO_TOM = {
  ok: "bg-success-bg text-success-fg",
  alerta: "bg-warning-bg text-warning-fg",
  perigo: "bg-error-bg text-error-fg",
  info: "bg-accent/10 text-accent",
  neutro: "bg-surface-muted text-text-muted",
} as const;

function tresAvisos(avisos: readonly number[]): [string, string, string] {
  return [0, 1, 2].map((i) => (avisos[i] ? String(avisos[i]) : "")) as [string, string, string];
}

/** A quem o item nasce ligado, pelo que o tipo costuma ser e por onde a pessoa está. */
function vinculoInicial(liga: LigaA, contexto: ContextoDoEscopo): Pick<Rascunho, "noNegocio" | "naEmpresa" | "noContato" | "contatoId" | "empresaId"> {
  const base = { noNegocio: false, naEmpresa: false, noContato: false, contatoId: "", empresaId: "" };
  if (contexto.negocio) {
    if (liga === "empresa" && contexto.negocio.empresa_id) return { ...base, naEmpresa: true };
    if (liga === "contato" && contexto.negocio.contact_id) return { ...base, noContato: true };
    return { ...base, noNegocio: true };
  }
  if (contexto.empresa && !contexto.contato) {
    const primeiro = contexto.contatos_da_empresa[0]?.id ?? "";
    if (liga === "contato" && primeiro) return { ...base, contatoId: primeiro };
    return { ...base, naEmpresa: true };
  }
  if (contexto.contato) {
    if (liga === "empresa" && contexto.contato.empresa_id) return { ...base, naEmpresa: true };
    return { ...base, noContato: true };
  }
  return base;
}

function rascunhoDo(escolha: string, padroes: Padroes | null, contexto: ContextoDoEscopo, anterior: Rascunho | null, hoje: Dia): Rascunho {
  const categoria = padroes?.categoria ?? anterior?.categoria ?? "documento";
  const recorrencia = padroes?.recorrencia ?? "unica";
  const meses = padroes?.recorrencia_meses ?? 6;
  const vinculo = padroes ? vinculoInicial(padroes.liga_a, contexto) : anterior ?? vinculoInicial("negocio", contexto);
  const dono = contexto.negocio?.dono_user_id ?? "";
  return {
    escolha,
    nomeLivre: anterior?.nomeLivre ?? "",
    categoria,
    quem: padroes?.quem_entrega ?? (categoria === "atividade" ? "nos" : "cliente"),
    recorrencia,
    meses: String(meses),
    validadeMeses: String(padroes?.validade_meses ?? 0),
    avisos: tresAvisos(padroes?.avisos_dias ?? AVISOS_PADRAO),
    semResposta: String(padroes?.dias_sem_resposta ?? DIAS_SEM_RESPOSTA_PADRAO),
    responsavel: anterior?.responsavel ?? dono,
    observacao: anterior?.observacao ?? "",
    pedido: "",
    prazo: "",
    recebido: "",
    validade: "",
    proxima:
      categoria === "atividade"
        ? somarMeses(hoje, mesesDaRecorrencia({ recorrencia, recorrencia_meses: recorrencia === "n_meses" ? meses : null }) || 1)
        : "",
    noNegocio: vinculo.noNegocio,
    naEmpresa: vinculo.naEmpresa,
    noContato: vinculo.noContato,
    contatoId: vinculo.contatoId,
    empresaId: vinculo.empresaId,
  };
}

export function FormularioDeObrigacao({
  aberto,
  aoFechar,
  contexto,
  hoje,
  aoAdicionar,
}: {
  aberto: boolean;
  aoFechar: () => void;
  contexto: ContextoDoEscopo;
  hoje: Dia;
  /** Depois de salvar: quem abriu decide (em geral, abrir a folha do item novo). */
  aoAdicionar?: (id: string) => void;
}) {
  const t = useT();
  const catalogo = useTiposDeObrigacao(aberto);
  const { data: membros } = useAssignableMembers(aberto);
  const acoes = useAcoesDeObrigacao();
  const naLista = !contexto.negocio && !contexto.empresa && !contexto.contato;
  const [contatoDaLista, setContatoDaLista] = useState<Contact | null>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erro, setErro] = useState("");

  const funilId = contexto.negocio?.pipeline_id ?? null;
  const tipos = useMemo(() => catalogo.data?.tipos ?? [], [catalogo.data]);
  const modelos = useMemo(() => catalogo.data?.modelos ?? [], [catalogo.data]);
  const doFunil = useMemo(() => tipos.filter((x) => funilId !== null && x.pipeline_id === funilId), [tipos, funilId]);
  const daEmpresa = useMemo(() => {
    // Fora de um negócio, todos os tipos da empresa entram, sem repetir o nome.
    const resto = tipos.filter((x) => !(funilId !== null && x.pipeline_id === funilId) && (funilId === null || x.pipeline_id === null));
    const vistos = new Set(doFunil.map((x) => x.nome.toLowerCase()));
    return resto.filter((x) => (vistos.has(x.nome.toLowerCase()) ? false : (vistos.add(x.nome.toLowerCase()), true)));
  }, [tipos, doFunil, funilId]);

  const padroesDe = (escolha: string): Padroes | null => {
    if (escolha.startsWith("t:")) {
      const tipo = tipos.find((x) => x.id === escolha.slice(2));
      return tipo ? { ...tipo } : null;
    }
    if (escolha.startsWith("m:")) {
      const modelo: ModeloDeTipo | undefined = modelos[Number(escolha.slice(2))];
      return modelo ? { ...modelo, id: null } : null;
    }
    return null;
  };

  const [r, setR] = useState<Rascunho | null>(null);
  // Ajustes durante o render, e não num efeito: fechou, o rascunho some; abriu (e
  // o catálogo chegou), nasce com o primeiro tipo do funil, ou com o nome livre.
  const [abertoVisto, setAbertoVisto] = useState(aberto);
  if (abertoVisto !== aberto) {
    setAbertoVisto(aberto);
    if (!aberto) {
      setR(null);
      setArquivo(null);
      setErro("");
      setContatoDaLista(null);
    }
  }
  if (aberto && r === null && !catalogo.isLoading) {
    const primeira = doFunil[0] ? `t:${doFunil[0].id}` : daEmpresa[0] ? `t:${daEmpresa[0].id}` : OUTRO;
    setR(rascunhoDo(primeira, padroesDe(primeira), contexto, null, hoje));
  }

  const mudar = (patch: Partial<Rascunho>) => setR((antes) => (antes ? { ...antes, ...patch } : antes));
  const padroes = r ? padroesDe(r.escolha) : null;
  const nome = padroes?.nome ?? r?.nomeLivre.trim() ?? "";
  const atividade = r?.categoria === "atividade";

  /** O item como ele nasceria, para a prévia da situação. */
  const previa = useMemo((): ItemParaSituacao | null => {
    if (!r) return null;
    const recorrenciaMeses = r.recorrencia === "n_meses" ? Number(r.meses) || null : null;
    const validadeMeses = Number(r.validadeMeses) || 0;
    const datas = datasAoAdicionar(
      {
        categoria: r.categoria,
        recorrencia: r.recorrencia,
        recorrencia_meses: recorrenciaMeses,
        validade_meses: validadeMeses,
        pedido_em: comoDia(r.pedido),
        prazo_em: comoDia(r.prazo),
        recebido_em: comoDia(r.recebido),
        valido_ate: comoDia(r.validade),
        proxima_em: comoDia(r.proxima),
      },
      hoje,
    );
    return {
      categoria: r.categoria,
      recorrencia: r.recorrencia,
      recorrencia_meses: recorrenciaMeses,
      validade_meses: validadeMeses,
      avisos_dias: normalizarAvisos(r.avisos.map(Number)),
      dias_sem_resposta: Number(r.semResposta) || DIAS_SEM_RESPOSTA_PADRAO,
      cobrado_em: null,
      renovado_em: null,
      ...datas,
    };
  }, [r, hoje]);

  function salvar() {
    if (!r || !previa) return;
    if (!nome) return setErro(t("Dê um nome ao item."));
    const leadId = r.noNegocio ? (contexto.negocio?.id ?? null) : null;
    const empresaId = naLista
      ? r.empresaId || null
      : r.naEmpresa
        ? (contexto.empresa?.id ?? contexto.negocio?.empresa_id ?? contexto.contato?.empresa_id ?? null)
        : null;
    const contatoId = naLista
      ? (contatoDaLista?.id ?? null)
      : r.noContato
        ? (contexto.contato?.id ?? contexto.negocio?.contact_id ?? null)
        : r.contatoId || null;
    if (!leadId && !empresaId && !contatoId) {
      return setErro(t("Ligue o item a um negócio, a uma empresa ou a um contato (pelo menos um)."));
    }
    if (r.recorrencia === "n_meses" && !(Number(r.meses) >= 1)) {
      return setErro(t("Diga de quantos em quantos meses o item se repete."));
    }
    setErro("");
    const item: NovaObrigacao = {
      nome,
      nome_curto: padroes?.nome_curto ?? null,
      tipo_id: padroes?.id ?? null,
      categoria: r.categoria,
      lead_id: leadId,
      empresa_id: empresaId,
      contact_id: contatoId,
      quem_entrega: r.quem,
      recorrencia: r.recorrencia,
      recorrencia_meses: previa.recorrencia_meses,
      validade_meses: previa.validade_meses,
      avisos_dias: [...previa.avisos_dias],
      dias_sem_resposta: previa.dias_sem_resposta,
      responsavel_user_id: r.responsavel || null,
      observacao: r.observacao.trim() || null,
      ...(atividade
        ? { proxima_em: previa.proxima_em }
        : { pedido_em: previa.pedido_em, prazo_em: previa.prazo_em, recebido_em: previa.recebido_em, valido_ate: previa.valido_ate }),
    };
    acoes.adicionar.mutate(
      { item, arquivo: atividade ? null : arquivo },
      {
        onSuccess: (criado) => {
          toast.success(`${t("Adicionado:")} ${nome} · ${t("situação calculada:")} ${t(ROTULO_DA_SITUACAO[situacao(previa, hoje)])}.`);
          aoFechar();
          aoAdicionar?.(criado.id);
        },
      },
    );
  }

  const dica =
    padroes?.liga_a === "empresa"
      ? t("Este tipo é da empresa: aparece em todos os negócios dela.")
      : padroes?.liga_a === "contato"
        ? t("Este tipo é do contato: acompanha a pessoa em qualquer negócio.")
        : t("Este tipo é do negócio: só aparece nele.");

  return (
    <Sheet open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-xl" data-testid="formulario-de-obrigacao">
        <SheetHeader className="pb-3 pr-8">
          <SheetTitle className="text-base">{t("Adicionar documento ou atividade")}</SheetTitle>
          <SheetDescription className="text-xs">
            {t("O tipo já traz validade, recorrência e avisos; tudo pode ser mudado.")}
          </SheetDescription>
        </SheetHeader>

        {!r ? (
          <p className="text-xs text-text-muted">{t("Carregando…")}</p>
        ) : (
          <form
            className="space-y-3 text-xs"
            onSubmit={(e) => {
              e.preventDefault();
              salvar();
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="ob-tipo" className="text-xs">
                {t("Tipo")}
              </Label>
              <select
                id="ob-tipo"
                value={r.escolha}
                onChange={(e) => setR(rascunhoDo(e.target.value, padroesDe(e.target.value), contexto, r, hoje))}
                className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
              >
                {doFunil.length > 0 ? (
                  <optgroup label={t("Tipos deste funil")}>
                    {doFunil.map((x) => (
                      <option key={x.id} value={`t:${x.id}`}>
                        {x.nome}
                        {x.categoria === "atividade" ? ` · ${t("atividade recorrente")}` : ""}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {daEmpresa.length > 0 ? (
                  <optgroup label={t("Tipos da empresa")}>
                    {daEmpresa.map((x) => (
                      <option key={x.id} value={`t:${x.id}`}>
                        {x.nome}
                        {x.categoria === "atividade" ? ` · ${t("atividade recorrente")}` : ""}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {SEGMENTOS_DE_OBRIGACAO.map((segmento) => (
                  <optgroup key={segmento} label={`${t("Modelo")} · ${t(ROTULO_DO_SEGMENTO_DE_OBRIGACAO[segmento])}`}>
                    {modelos.map((m, i) =>
                      m.segmento === segmento ? (
                        <option key={`${segmento}-${m.nome}`} value={`m:${i}`}>
                          {m.nome}
                          {m.categoria === "atividade" ? ` · ${t("atividade recorrente")}` : ""}
                        </option>
                      ) : null,
                    )}
                  </optgroup>
                ))}
                <option value={OUTRO}>{t("Outro · escrever o nome")}</option>
              </select>
            </div>

            {padroes ? null : (
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="ob-nome" className="text-xs">
                    {t("Nome")}
                  </Label>
                  <Input
                    id="ob-nome"
                    value={r.nomeLivre}
                    maxLength={120}
                    onChange={(e) => mudar({ nomeLivre: e.target.value })}
                    placeholder={t("Ex.: Certidão negativa de débitos")}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ob-categoria" className="text-xs">
                    {t("É um")}
                  </Label>
                  <select
                    id="ob-categoria"
                    value={r.categoria}
                    onChange={(e) => {
                      const categoria = e.target.value as Categoria;
                      mudar({
                        categoria,
                        quem: categoria === "atividade" ? "nos" : "cliente",
                        proxima: categoria === "atividade" && !r.proxima ? somarMeses(hoje, 1) : r.proxima,
                      });
                    }}
                    className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
                  >
                    <option value="documento">{t(ROTULO_DA_CATEGORIA.documento)}</option>
                    <option value="atividade">{t(ROTULO_DA_CATEGORIA.atividade)}</option>
                  </select>
                </div>
              </div>
            )}
            {nome && ehTipoSensivel(nome) ? (
              <p className="rounded-md bg-warning-bg px-2 py-1.5 text-[11px] text-warning-fg">
                {t("Documento de saúde é dado sensível. Guarde só o necessário: o arquivo fica em área privada e é apagado junto com o contato num pedido de esquecimento.")}
              </p>
            ) : null}

            <fieldset className="space-y-1.5">
              <legend className="text-xs font-medium text-text">{t("Ligado a · pelo menos um")}</legend>
              {contexto.negocio ? (
                <>
                  <Caixa marcado={r.noNegocio} aoMudar={(v) => mudar({ noNegocio: v })}>
                    {t("Este negócio")} · {contexto.negocio.titulo}
                  </Caixa>
                  {contexto.empresa ? (
                    <Caixa marcado={r.naEmpresa} aoMudar={(v) => mudar({ naEmpresa: v })}>
                      {t("A empresa")} · {contexto.empresa.nome}
                    </Caixa>
                  ) : null}
                  {contexto.contato ? (
                    <Caixa marcado={r.noContato} aoMudar={(v) => mudar({ noContato: v })}>
                      {t("O contato")} · {contexto.contato.nome}
                    </Caixa>
                  ) : null}
                </>
              ) : contexto.empresa && !contexto.contato ? (
                <>
                  <Caixa marcado={r.naEmpresa} aoMudar={(v) => mudar({ naEmpresa: v })}>
                    {t("A empresa")} · {contexto.empresa.nome}
                  </Caixa>
                  <div className="space-y-1">
                    <Label htmlFor="ob-contato-da-empresa" className="text-xs">
                      {t("Um contato da empresa")}
                    </Label>
                    <select
                      id="ob-contato-da-empresa"
                      value={r.contatoId}
                      onChange={(e) => mudar({ contatoId: e.target.value })}
                      className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
                    >
                      <option value="">{t("Nenhum")}</option>
                      {contexto.contatos_da_empresa.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nome}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              ) : contexto.contato ? (
                <>
                  <Caixa marcado={r.noContato} aoMudar={(v) => mudar({ noContato: v })}>
                    {t("O contato")} · {contexto.contato.nome}
                  </Caixa>
                  {contexto.empresa ? (
                    <Caixa marcado={r.naEmpresa} aoMudar={(v) => mudar({ naEmpresa: v })}>
                      {t("A empresa")} · {contexto.empresa.nome}
                    </Caixa>
                  ) : null}
                </>
              ) : (
                <div className="space-y-2">
                  <EscolhaDeEmpresa valor={r.empresaId} aoMudar={(empresaId) => mudar({ empresaId })} />
                  <div className="space-y-1">
                    <p className="text-xs text-text">{t("Contato")}</p>
                    <SeletorDeContato escolhido={contatoDaLista} onEscolher={setContatoDaLista} />
                    {contatoDaLista ? (
                      <p className="text-[11px] text-text-muted">{nomeDoContato(contatoDaLista) ?? t("Contato")}</p>
                    ) : null}
                  </div>
                  <p className="text-[11px] text-text-muted">
                    {t("Para ligar o item a um negócio, abra o cartão do negócio e use Adicionar em Documentos e obrigações.")}
                  </p>
                </div>
              )}
              {padroes ? <p className="text-[11px] text-text-muted">{dica}</p> : null}
            </fieldset>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="ob-quem" className="text-xs">
                  {t("Quem entrega")}
                </Label>
                <select
                  id="ob-quem"
                  value={r.quem}
                  onChange={(e) => mudar({ quem: e.target.value as QuemEntrega })}
                  className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
                >
                  <option value="cliente">{t(ROTULO_DE_QUEM_ENTREGA.cliente)}</option>
                  <option value="nos">{t(ROTULO_DE_QUEM_ENTREGA.nos)}</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="ob-responsavel" className="text-xs">
                  {t("Responsável")}
                </Label>
                <select
                  id="ob-responsavel"
                  value={r.responsavel}
                  onChange={(e) => mudar({ responsavel: e.target.value })}
                  className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
                >
                  <option value="">{t("Sem responsável")}</option>
                  {(membros ?? []).map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.full_name ?? t("Sem nome")}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {atividade ? (
              <CampoDeData id="ob-proxima" rotulo={t("Próxima data")} valor={r.proxima} aoMudar={(v) => mudar({ proxima: v })} />
            ) : (
              <>
                <div className="grid gap-2 sm:grid-cols-2">
                  <CampoDeData id="ob-pedido" rotulo={t("Pedido em")} valor={r.pedido} aoMudar={(v) => mudar({ pedido: v })} />
                  <CampoDeData id="ob-prazo" rotulo={t("Prazo para entregar")} valor={r.prazo} aoMudar={(v) => mudar({ prazo: v })} />
                  <CampoDeData id="ob-recebido" rotulo={t("Recebido em")} valor={r.recebido} aoMudar={(v) => mudar({ recebido: v })} />
                  <CampoDeData id="ob-validade" rotulo={t("Válido até")} valor={r.validade} aoMudar={(v) => mudar({ validade: v })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ob-validade-meses" className="text-xs">
                    {t("Validade padrão, em meses (0 = sem validade)")}
                  </Label>
                  <Input
                    id="ob-validade-meses"
                    type="number"
                    min={0}
                    max={600}
                    value={r.validadeMeses}
                    onChange={(e) => mudar({ validadeMeses: e.target.value })}
                    className="h-8 text-xs"
                  />
                  <p className="text-[11px] text-text-muted">{t("Se \"válido até\" ficar vazio, ele é calculado a partir do recebimento.")}</p>
                </div>
              </>
            )}

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="ob-recorrencia" className="text-xs">
                  {t("Recorrência")}
                </Label>
                <select
                  id="ob-recorrencia"
                  value={r.recorrencia}
                  onChange={(e) => mudar({ recorrencia: e.target.value as Recorrencia })}
                  className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
                >
                  {RECORRENCIAS.map((rec) => (
                    <option key={rec} value={rec}>
                      {t(ROTULO_DA_RECORRENCIA[rec])}
                    </option>
                  ))}
                </select>
              </div>
              {r.recorrencia === "n_meses" ? (
                <div className="space-y-1">
                  <Label htmlFor="ob-meses" className="text-xs">
                    {t("N (meses)")}
                  </Label>
                  <Input id="ob-meses" type="number" min={1} max={240} value={r.meses} onChange={(e) => mudar({ meses: e.target.value })} className="h-8 text-xs" />
                </div>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-text">{t("Antecedência dos avisos")}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <span>{t("Avisar")}</span>
                {[0, 1, 2].map((i) => (
                  <Input
                    key={i}
                    type="number"
                    min={1}
                    max={3650}
                    value={r.avisos[i]}
                    aria-label={`${i + 1}º ${t("aviso, dias antes")}`}
                    onChange={(e) => {
                      const avisos = [...r.avisos] as [string, string, string];
                      avisos[i] = e.target.value;
                      mudar({ avisos });
                    }}
                    className="h-7 w-16 text-xs"
                  />
                ))}
                <span>{t("dias antes")}</span>
              </div>
              {atividade ? null : (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span>{t("e se foi pedido há")}</span>
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    value={r.semResposta}
                    aria-label={t("dias sem receber")}
                    onChange={(e) => mudar({ semResposta: e.target.value })}
                    className="h-7 w-16 text-xs"
                  />
                  <span>{t("dias sem receber")}</span>
                </div>
              )}
            </div>

            {atividade ? null : (
              <div className="space-y-1">
                <Label htmlFor="ob-arquivo" className="text-xs">
                  {t("Arquivo (opcional, fica em área privada)")}
                </Label>
                <Input
                  id="ob-arquivo"
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.doc,.docx,.xls,.xlsx"
                  onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
                  className="h-8 text-xs"
                />
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="ob-observacao" className="text-xs">
                {t("Observação")}
              </Label>
              <Textarea id="ob-observacao" rows={2} maxLength={2000} value={r.observacao} onChange={(e) => mudar({ observacao: e.target.value })} className="text-xs" />
            </div>

            {previa ? (
              <div className="rounded-md border border-border p-2" data-testid="previa-da-situacao">
                <p className="text-[11px] text-text-muted">{t("Situação calculada pelas datas (ninguém digita)")}</p>
                <p className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", COR_DO_TOM[tomDaSituacao(previa, hoje)])}>
                    {t(ROTULO_DA_SITUACAO[situacao(previa, hoje)])}
                  </span>
                  <span className="text-text-muted">{textoDaSituacao(previa, hoje, t)}</span>
                </p>
              </div>
            ) : null}

            {erro ? <p className="text-xs text-error-fg">{erro}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" className="h-8 text-xs" disabled={acoes.adicionar.isPending}>
                {t("Adicionar")}
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={aoFechar}>
                {t("Cancelar")}
              </Button>
            </div>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Só na lista geral: a empresa é escolhida por busca (a lista de uma carteira não cabe num seletor). */
function EscolhaDeEmpresa({ valor, aoMudar }: { valor: string; aoMudar: (id: string) => void }) {
  const t = useT();
  const [busca, setBusca] = useState("");
  const empresas = useEmpresas(busca);
  return (
    <div className="space-y-1">
      <Label htmlFor="ob-empresa" className="text-xs">
        {t("Empresa")}
      </Label>
      <Input
        id="ob-busca-de-empresa"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder={t("Buscar empresa pelo nome")}
        aria-label={t("Buscar empresa pelo nome")}
        className="h-8 text-xs"
      />
      <select
        id="ob-empresa"
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
      >
        <option value="">{t("Nenhuma")}</option>
        {(empresas.data?.data ?? []).map((empresa) => (
          <option key={empresa.id} value={empresa.id}>
            {empresa.nome}
          </option>
        ))}
      </select>
    </div>
  );
}

function Caixa({ marcado, aoMudar, children }: { marcado: boolean; aoMudar: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex items-start gap-2 text-xs text-text">
      <input type="checkbox" className="mt-0.5" checked={marcado} onChange={(e) => aoMudar(e.target.checked)} />
      <span className="min-w-0 break-words">{children}</span>
    </label>
  );
}

function CampoDeData({ id, rotulo, valor, aoMudar }: { id: string; rotulo: string; valor: string; aoMudar: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {rotulo}
      </Label>
      <Input id={id} type="date" value={valor} onChange={(e) => aoMudar(e.target.value)} className="h-8 text-xs" />
    </div>
  );
}
