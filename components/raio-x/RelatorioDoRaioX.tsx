/**
 * FORK MIA (.101) · O RELATÓRIO DO RAIO-X NA TELA (protótipo, telas 4 e 5).
 *
 * Componente de SERVIDOR (sem estado): recebe o `t` e a etiqueta do idioma de
 * quem lê. Duas formas:
 *
 *  - `RelatorioDaTime`: o relatório inteiro, com o bloco "o que a MIA
 *    resolveria" (decisão 9) e "sobre esta análise" (o custo, só para a Time);
 *  - `RelatorioDoDono`: o resumo em uma página do link do dono, SEM custo, sem
 *    o bloco da MIA e sem as anotações da Time.
 *
 * Os clientes aparecem por número de ordem; os trechos já vêm anonimizados do
 * servidor (`lib/raio-x/anonimizar.ts`).
 *
 * FORK MIA (.102) · o relatório do CLIENTE ATIVO (protótipo de 05/11/2026,
 * telas 5 a 7): o mesmo relatório, mais quem respondeu primeiro, a espera
 * depois da passagem para um vendedor, no que virou no funil da conta e "onde
 * ainda dá para ganhar" no lugar do "o que a MIA resolveria". O antes e depois
 * mostra os dois períodos, esconde a linha que nenhum dos dois mede e marca
 * como "novo" o que o raio-X por conexão não tinha.
 */
import type { Comparacao, Indicador } from "@/lib/raio-x/comparacao";
import { ROTULO_DO_INDICADOR } from "@/lib/raio-x/comparacao";
import { FAIXAS_DA_ESPERA } from "@/lib/raio-x/passagem";
import type { Balao, BlocoDoClienteAtivo, DadosDoDono, DadosDoRelatorio, Recomendacao } from "@/lib/raio-x/relatorio";
import { CRITERIOS, ROTULO_DO_CRITERIO } from "@/lib/raio-x/segmentos";

import {
  CLASSE_DO_TOM,
  DIAS,
  FAIXAS,
  ROTULO_DA_FAIXA,
  ROTULO_DA_FAIXA_DA_ESPERA,
  ROTULO_DE_QUEM,
  ROTULO_DO_DIA,
  diaValido,
  faixaValida,
  minutosOuSegundosParaLer,
  minutosParaLer,
  notaParaLer,
  proporcaoParaLer,
  segundosParaLer,
  tomDoTempo,
} from "./rotulos";

type T = (s: string) => string;

interface Comum {
  t: T;
  tag: string;
}

function Bloco({ titulo, children, id }: { titulo: string; children: React.ReactNode; id?: string }) {
  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface p-5" data-raio-x-bloco={id}>
      <h2 className="text-base font-semibold">{titulo}</h2>
      {children}
    </section>
  );
}

function Numero({ valor, rotulo, nota }: { valor: string; rotulo: string; nota?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-2xl font-semibold tabular-nums">{valor}</div>
      <div className="text-sm text-text-muted">{rotulo}</div>
      {nota ? <div className="text-xs text-text-muted">{nota}</div> : null}
    </div>
  );
}

/**
 * FORK MIA (.102): a mediana da primeira resposta em SEGUNDOS quando o relatório
 * a tem (a IA responde em segundos); nos da .101, em minutos, como antes.
 */
function tempoDe(tempo: DadosDoDono["tempo"], qual: "geral" | "aberta" | "fechada"): string {
  const seg = qual === "geral" ? tempo.medianaPrimeiraRespostaSeg : qual === "aberta" ? tempo.medianaComALojaAbertaSeg : tempo.medianaComALojaFechadaSeg;
  if (seg !== undefined && seg !== null) return segundosParaLer(seg);
  return minutosParaLer(qual === "geral" ? tempo.medianaPrimeiraRespostaMin : qual === "aberta" ? tempo.medianaComALojaAbertaMin : tempo.medianaComALojaFechadaMin);
}

function Barras({ itens, total, tag }: { itens: Array<{ rotulo: string; valor: number; tom?: "ok" | "warn" | "danger"; texto: string }>; total: number; tag: string }) {
  void tag;
  return (
    <ul className="space-y-2">
      {itens.map((i) => (
        <li key={i.rotulo} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] items-center gap-3 text-sm">
          <span>{i.rotulo}</span>
          <span className="h-2 overflow-hidden rounded-full bg-surface-elevated" aria-hidden="true">
            <span
              className={`block h-2 rounded-full ${i.tom === "danger" ? "bg-error" : i.tom === "warn" ? "bg-warning" : "bg-primary"}`}
              style={{ width: `${total > 0 ? Math.max(2, Math.round((i.valor / total) * 100)) : 0}%` }}
            />
          </span>
          <b className="tabular-nums">{i.texto}</b>
        </li>
      ))}
    </ul>
  );
}

function valorDoIndicador(indicador: Indicador, v: number | null, tag: string): string {
  if (indicador === "notaMedia") return notaParaLer(v, tag);
  if (indicador.startsWith("proporcao")) return proporcaoParaLer(v);
  return minutosOuSegundosParaLer(v);
}

function diaEMesDe(iso: string, tag: string, menosUmMs = false): string {
  const d = new Date(Date.parse(iso) - (menosUmMs ? 1 : 0));
  return new Intl.DateTimeFormat(tag, { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" }).format(d);
}

/** "06/09 a 04/11": o período do relatório (o do cliente ativo tem fim exclusivo, à meia-noite). */
function periodoParaLer(p: { inicio: string; fim: string }, t: T, tag: string, fimExclusivo: boolean): string {
  return `${diaEMesDe(p.inicio, tag)} ${t("a")} ${diaEMesDe(p.fim, tag, fimExclusivo)}`;
}

function dataCurta(iso: string, tag: string): string {
  return new Intl.DateTimeFormat(tag, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" }).format(new Date(iso));
}

/** O texto de cada recomendação, no idioma de quem lê. */
export function textoDaRecomendacao(r: Recomendacao, { t }: Comum): { titulo: string; corpo: string } {
  const v = r.valores;
  const n = String(v.n ?? "");
  switch (r.codigo) {
    case "fora_do_horario":
      return {
        titulo: t("Responder fora do horário."),
        corpo: t("{p} das conversas chegam com a loja fechada, e a primeira resposta leva {m}. Uma mensagem automática de boas-vindas já seguraria esse cliente.")
          .replace("{p}", proporcaoParaLer(v.proporcao as number | null))
          .replace("{m}", minutosParaLer(v.mediana as number | null)),
      };
    case "voltar_a_chamar":
      return {
        titulo: t("Voltar a chamar quem sumiu."),
        corpo: t("{n} clientes pararam de responder depois da resposta da loja, e ninguém voltou a chamar. Um retorno em 24 horas recupera parte deles.").replace("{n}", n),
      };
    case "mandar_o_valor":
      return {
        titulo: t("Sempre mandar o valor quando o cliente pede."),
        corpo: t("{n} pediram o valor ou a proposta e não receberam.").replace("{n}", n),
      };
    case "sem_resposta":
      return {
        titulo: t("Responder todo mundo."),
        corpo: t("{n} conversas ({p}) ficaram sem nenhuma resposta da loja.").replace("{n}", n).replace("{p}", proporcaoParaLer(v.proporcao as number | null)),
      };
    case "primeira_resposta_lenta":
      return {
        titulo: t("Responder mais rápido com a loja aberta."),
        corpo: t("Com a loja aberta, metade das conversas espera {m} pela primeira resposta.").replace("{m}", minutosParaLer(v.mediana as number | null)),
      };
    case "pico":
      return {
        titulo: t("Reforçar o horário de pico."),
        corpo: t("{dia}, {faixa}, é quando mais chega: {n} conversas, com primeira resposta em {m}. Vale ter mais alguém no WhatsApp nesse horário.")
          .replace("{dia}", t(ROTULO_DO_DIA[diaValido(v.dia)]))
          .replace("{faixa}", t(ROTULO_DA_FAIXA[faixaValida(v.faixa)]))
          .replace("{n}", String(v.episodios ?? ""))
          .replace("{m}", minutosParaLer(v.mediana as number | null)),
      };
    // FORK MIA (.102): "onde ainda dá para ganhar", só no raio-X do cliente ativo.
    case "passagem_lenta":
      return {
        titulo: t("{n} clientes esperaram mais de 2 h depois da passagem, ou ninguém assumiu.").replace("{n}", n),
        corpo: v.fora
          ? t("Ligar o aviso no celular do vendedor de plantão à noite e no fim de semana.")
          : t("Ligar o aviso no celular do vendedor quando a MIA passa a conversa."),
      };
    case "respondidas_pelo_celular":
      return {
        titulo: t("{n} conversas foram respondidas pelo celular.").replace("{n}", n),
        corpo: t("Elas ficam fora do funil: responder pela MIA para o negócio e o histórico ficarem completos."),
      };
    case "numero_sem_followup":
      return {
        titulo: t("O número {numero} não faz follow-up.").replace("{numero}", String(v.numero ?? "")),
        corpo: t("{n} clientes sumiram sem receber retorno. Ligar o follow-up desse número.").replace("{n}", n),
      };
  }
}

function Evolucao({ comparacao, c }: { comparacao: Comparacao; c: Comum }) {
  const { t, tag } = c;
  const rotuloDaDirecao = (d: string | null, aviso: string | null) => {
    if (aviso === "novo") return <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{t("novo")}</span>;
    if (aviso) return <span className="rounded-full bg-warning-bg px-2 py-0.5 text-xs text-warning-fg">{t("critérios diferentes")}</span>;
    if (d === "melhor") return <span className="rounded-full bg-success-bg px-2 py-0.5 text-xs text-success-fg">{t("melhorou")}</span>;
    if (d === "pior") return <span className="rounded-full bg-error-bg px-2 py-0.5 text-xs text-error-fg">{t("piorou")}</span>;
    if (d === "igual") return <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-xs text-text-muted">{t("igual")}</span>;
    return <span className="text-xs text-text-muted">·</span>;
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">
        {t("Melhorou em {m} dos {n} indicadores. Piorou em {p}.")
          .replace("{m}", String(comparacao.melhorou))
          .replace("{n}", String(comparacao.comparaveis))
          .replace("{p}", String(comparacao.piorou))}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="text-left text-text-muted">
              <th className="py-1 pr-3 font-medium">{t("Indicador")}</th>
              {comparacao.anteriorPeriodo ? (
                <th className="py-1 pr-3 font-medium">
                  {t("Antes")} · {periodoParaLer(comparacao.anteriorPeriodo, t, tag, comparacao.anteriorFonte === "conversas_da_mia")}
                  <div className="font-normal">{t("{n} conversas").replace("{n}", String(comparacao.conversasAntes))}</div>
                </th>
              ) : (
                <th className="py-1 pr-3 font-medium">
                  {t("Raio-X de")} {dataCurta(comparacao.anteriorEm, tag)}
                </th>
              )}
              {comparacao.agoraPeriodo ? (
                <th className="py-1 pr-3 font-medium">
                  {t("Agora")} · {periodoParaLer(comparacao.agoraPeriodo, t, tag, comparacao.fonte === "conversas_da_mia")}
                  <div className="font-normal">{t("{n} conversas").replace("{n}", String(comparacao.conversasAgora))}</div>
                </th>
              ) : (
                <th className="py-1 pr-3 font-medium">{t("Agora")}</th>
              )}
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {/* FORK MIA (.102): a linha que nenhum dos dois relatórios mede não aparece. */}
            {comparacao.linhas.filter((l) => l.anterior !== null || l.agora !== null).map((l) => (
              <tr key={l.indicador} className="border-t border-border" data-raio-x-evolucao={l.indicador}>
                <td className="py-2 pr-3">{t(ROTULO_DO_INDICADOR[l.indicador])}</td>
                <td className="py-2 pr-3 tabular-nums">{l.aviso === "novo" ? t("não existia") : valorDoIndicador(l.indicador, l.anterior, tag)}</td>
                <td className="py-2 pr-3 font-semibold tabular-nums">{valorDoIndicador(l.indicador, l.agora, tag)}</td>
                <td className="py-2">{rotuloDaDirecao(l.direcao, l.aviso)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-text-muted">
        {t("Os números estão em proporção, porque o total de conversas muda ({a} no anterior, {b} agora).")
          .replace("{a}", String(comparacao.conversasAntes))
          .replace("{b}", String(comparacao.conversasAgora))}{" "}
        {comparacao.criteriosIguais
          ? t("A nota usa os mesmos critérios nos dois.")
          : t("Os critérios da nota mudaram entre os dois: a nota aparece com aviso e não é comparada.")}
      </p>
    </div>
  );
}

// ─── FORK MIA (.102) · os blocos do cliente ativo ───────────────────────────

const percentual = (parte: number, todo: number) => (todo > 0 ? `${Math.round((parte / todo) * 100)}%` : "·");

function QuemRespondeuPrimeiro({ bloco, c }: { bloco: BlocoDoClienteAtivo; c: Comum }) {
  const { t } = c;
  const q = bloco.quemRespondeu;
  return (
    <Bloco titulo={t("Quem respondeu primeiro")} id="quem-respondeu">
      <p className="flex flex-wrap gap-2 text-sm">
        {q.linhas.map((l) => (
          <span key={l.quem} className="rounded-full bg-surface-elevated px-2 py-0.5">
            {t(ROTULO_DE_QUEM[l.quem])} · {l.conversas}
          </span>
        ))}
        <span className="rounded-full bg-error-bg px-2 py-0.5 text-error-fg">
          {t("Sem resposta")} · {q.semResposta}
        </span>
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="text-left text-text-muted">
              <th className="py-1 pr-3 font-medium">{t("Quem")}</th>
              <th className="py-1 pr-3 font-medium">{t("Conversas")}</th>
              <th className="py-1 pr-3 font-medium">{t("1ª resposta (mediana)")}</th>
              <th className="py-1 font-medium">{t("Fora do horário")}</th>
            </tr>
          </thead>
          <tbody>
            {q.linhas.map((l) => (
              <tr key={l.quem} className="border-t border-border" data-raio-x-quem={l.quem}>
                <td className="py-2 pr-3">{t(ROTULO_DE_QUEM[l.quem])}</td>
                <td className="py-2 pr-3 tabular-nums">{l.conversas}</td>
                <td className="py-2 pr-3 tabular-nums">{segundosParaLer(l.medianaSeg)}</td>
                <td className="py-2 tabular-nums">
                  {l.quem === "ia" ? t("{n} de {total}").replace("{n}", String(l.foraDoHorario)).replace("{total}", String(q.chegaramComALojaFechada)) : l.foraDoHorario}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-text-muted">
        {t("“Celular do número” é a resposta dada no aparelho, fora da MIA: fica no histórico, mas sem quem respondeu e sem o funil.")}
      </p>
    </Bloco>
  );
}

function BalaoDoTrecho({ b, c }: { b: Balao; c: Comum }) {
  const { t } = c;
  return (
    <div className={`max-w-[90%] rounded-lg px-3 py-2 text-sm ${b.daLoja ? "ml-auto bg-primary/10" : "bg-surface-elevated"}`}>
      <div className="text-xs text-text-muted">{b.daLoja ? t(ROTULO_DE_QUEM[b.quem ?? "automacao"]) : t("Cliente")}</div>
      {b.audio ? <span className="text-text-muted">{t("(áudio)")} </span> : null}
      {b.texto}
    </div>
  );
}

function DepoisDaPassagem({ bloco, c }: { bloco: BlocoDoClienteAtivo; c: Comum }) {
  const { t } = c;
  const p = bloco.passagem;
  const trecho = bloco.trechoDaPassagem;
  return (
    <Bloco titulo={t("Depois que a IA passou para um vendedor")} id="passagem">
      <p className="text-sm">
        {p.conversas === 0
          ? t("Nenhuma conversa foi passada para a equipe no período.")
          : t("{n} conversas foram passadas para a equipe. É aqui que o cliente ativo ainda perde venda.").replace("{n}", String(p.conversas))}
      </p>
      {p.conversas > 0 ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="text-left text-text-muted">
                  <th className="py-1 pr-3 font-medium">{t("Tempo até um vendedor assumir")}</th>
                  <th className="py-1 pr-3 font-medium">{t("Conversas")}</th>
                  <th className="py-1 font-medium">%</th>
                </tr>
              </thead>
              <tbody>
                {FAIXAS_DA_ESPERA.map((f) => (
                  <tr key={f} className={`border-t border-border ${f === "mais_de_2_h" || f === "ninguem" ? "text-error-fg" : ""}`} data-raio-x-faixa-da-espera={f}>
                    <td className="py-2 pr-3">{t(ROTULO_DA_FAIXA_DA_ESPERA[f])}</td>
                    <td className="py-2 pr-3 tabular-nums">{p.faixas[f]}</td>
                    <td className="py-2 tabular-nums">{percentual(p.faixas[f], p.conversas - p.emAberto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-text-muted">
            {t("Mediana para assumir: {a} com a loja aberta e {b} quando a passagem foi à noite ou no fim de semana.")
              .replace("{a}", segundosParaLer(p.medianaComALojaAbertaMin === null ? null : p.medianaComALojaAbertaMin * 60))
              .replace("{b}", segundosParaLer(p.medianaComALojaFechadaMin === null ? null : p.medianaComALojaFechadaMin * 60))}
          </p>
        </>
      ) : null}
      {trecho ? (
        <div className="space-y-2 rounded-lg border border-border p-3" data-raio-x="trecho-da-passagem">
          <p className="text-xs text-text-muted">
            {t("Trecho anonimizado · passagem de {dia} às {hora}").replace("{dia}", t(ROTULO_DO_DIA[diaValido(trecho.dia)])).replace("{hora}", trecho.hora)}
          </p>
          {trecho.antes.map((b, i) => (
            <BalaoDoTrecho key={`a${i}`} b={b} c={c} />
          ))}
          <p className="text-center text-xs font-semibold text-error-fg">
            {trecho.esperaMin === null
              ? t("ninguém assumiu")
              : t("{t} sem resposta").replace("{t}", segundosParaLer(trecho.esperaMin * 60))}
          </p>
          {trecho.depois.map((b, i) => (
            <BalaoDoTrecho key={`d${i}`} b={b} c={c} />
          ))}
        </div>
      ) : null}
    </Bloco>
  );
}

function NoQueVirou({ bloco, c }: { bloco: BlocoDoClienteAtivo; c: Comum }) {
  const { t } = c;
  const f = bloco.funil;
  return (
    <Bloco titulo={t("No que virou")} id="funil">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Numero valor={String(f.passadas)} rotulo={t("Passadas para a equipe")} />
        <Numero valor={String(f.negocio)} rotulo={t("Viraram negócio")} />
        <Numero valor={String(f.visita)} rotulo={t("Visita agendada")} />
        <Numero valor={String(f.venda)} rotulo={t("Venda ganha")} />
      </div>
      <p className="text-xs text-text-muted">
        {t("Do funil da própria conta.")}{" "}
        {f.lentas > 0
          ? t("Das {n} conversas que esperaram mais de 2 h ou que ninguém assumiu, {v} viraram visita.").replace("{n}", String(f.lentas)).replace("{v}", String(f.lentasComVisita))
          : ""}
      </p>
    </Bloco>
  );
}

function OndeGanhar({ bloco, c, titulo }: { bloco: BlocoDoClienteAtivo; c: Comum; titulo: string }) {
  const { t } = c;
  return (
    <Bloco titulo={titulo} id="onde-ganhar">
      {bloco.ondeGanhar.length === 0 ? (
        <p className="text-sm text-text-muted">{t("Nenhum ponto crítico depois da passagem neste período.")}</p>
      ) : (
        <ul className="list-disc space-y-2 pl-5 text-sm">
          {bloco.ondeGanhar.map((r) => {
            const x = textoDaRecomendacao(r, c);
            return (
              <li key={`${r.codigo}-${String(r.valores.numero ?? "")}`}>
                <b>{x.titulo}</b> {x.corpo}
              </li>
            );
          })}
        </ul>
      )}
    </Bloco>
  );
}

function Origem({ dados, c }: { dados: Pick<DadosDoDono, "origem" | "numeros">; c: Comum }) {
  const { t, tag } = c;
  return (
    <Barras
      tag={tag}
      total={dados.numeros.conversas}
      itens={dados.origem.map((o) => ({ rotulo: t(o.rotulo), valor: o.conversas, texto: String(o.conversas) }))}
    />
  );
}

export function RelatorioDaTime({
  dados,
  comparacao,
  custoCentavos,
  t,
  tag,
}: {
  dados: DadosDoRelatorio;
  comparacao: Comparacao | null;
  custoCentavos: number;
  t: T;
  tag: string;
}) {
  const c = { t, tag };
  const reais = new Intl.NumberFormat(tag, { style: "currency", currency: "BRL" });
  const fechadas = dados.tempo.proporcaoComALojaFechada;
  // FORK MIA (.102): o cliente ativo.
  const ativo = dados.clienteAtivo;
  const notaAnterior = comparacao?.linhas.find((l) => l.indicador === "notaMedia" && l.aviso === null)?.anterior ?? null;
  return (
    <div className="space-y-5" data-raio-x="relatorio" data-raio-x-fonte-do-relatorio={dados.fonte ?? "conexao"}>
      {ativo ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Numero
            valor={String(dados.numeros.conversas)}
            rotulo={t("Clientes que chamaram")}
            nota={`${ativo.numeros.length === 1 ? t("1 número") : t("{n} números").replace("{n}", String(ativo.numeros.length))} · ${periodoParaLer(dados.periodo, t, tag, true)}`}
          />
          <Numero
            valor={percentual(ativo.quemRespondeu.respondidas, ativo.quemRespondeu.conversas)}
            rotulo={t("Responderam")}
            nota={t("{n} ficaram sem nenhuma resposta").replace("{n}", String(ativo.quemRespondeu.semResposta))}
          />
          <Numero valor={tempoDe(dados.tempo, "geral")} rotulo={t("metade responde em até")} />
          <Numero
            valor={notaParaLer(dados.notas.media, tag)}
            rotulo={t("Nota do atendimento")}
            nota={`${t("de 10 · critérios {v}").replace("{v}", dados.criteriosVersao)}${notaAnterior !== null ? ` · ${t("era {x} antes").replace("{x}", notaParaLer(notaAnterior, tag))}` : ""}`}
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Numero valor={String(dados.numeros.conversas)} rotulo={t("conversas de clientes")} />
          <Numero valor={tempoDe(dados.tempo, "geral")} rotulo={t("metade responde em até")} />
          <Numero valor={proporcaoParaLer(dados.tempo.proporcaoSemResposta)} rotulo={t("ficaram sem resposta")} />
          <Numero valor={proporcaoParaLer(dados.indicadores.proporcaoAgendou)} rotulo={t("agendaram o próximo passo")} />
          <Numero valor={notaParaLer(dados.notas.media, tag)} rotulo={t("nota do atendimento")} />
        </div>
      )}

      {ativo ? (
        <>
          <QuemRespondeuPrimeiro bloco={ativo} c={c} />
          <DepoisDaPassagem bloco={ativo} c={c} />
          <NoQueVirou bloco={ativo} c={c} />
          <OndeGanhar bloco={ativo} c={c} titulo={t("Onde ainda dá para ganhar")} />
        </>
      ) : null}

      {comparacao ? (
        <Bloco
          titulo={
            ativo && comparacao.anteriorFonte === "conexao"
              ? `${t("Antes e depois da MIA")} · ${comparacao.criteriosIguais ? t("mesmos critérios nos dois") : t("critérios diferentes")}`
              : `${t("Evolução desde o raio-X de")} ${dataCurta(comparacao.anteriorEm, tag)}`
          }
          id="evolucao"
        >
          <Evolucao comparacao={comparacao} c={c} />
        </Bloco>
      ) : null}

      <Bloco titulo={t("Velocidade da primeira resposta")} id="velocidade">
        <p className="text-sm text-text-muted">
          {t("Com a loja aberta, metade das conversas tem a primeira resposta em {a}. Com a loja fechada, em {b}; {p} das conversas chegam nessa hora.")
            .replace("{a}", tempoDe(dados.tempo, "aberta"))
            .replace("{b}", tempoDe(dados.tempo, "fechada"))
            .replace("{p}", proporcaoParaLer(fechadas))}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-separate border-spacing-1 text-center text-xs">
            <thead>
              <tr>
                <th />
                {DIAS.map((d) => (
                  <th key={d} className="font-medium text-text-muted">
                    {t(ROTULO_DO_DIA[d])}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FAIXAS.map((i) => (
                <tr key={i}>
                  <th className="pr-2 text-right font-medium text-text-muted">{t(ROTULO_DA_FAIXA[i])}</th>
                  {DIAS.map((d) => {
                    const cel = dados.tempo.mapa[d]?.[i] ?? { episodios: 0, medianaMin: null };
                    return (
                      <td key={d} className={`rounded-md p-2 ${CLASSE_DO_TOM[tomDoTempo(cel.medianaMin)]}`}>
                        <div className="font-semibold">{minutosParaLer(cel.medianaMin)}</div>
                        <div className="opacity-80">
                          {cel.episodios} {t("conversas")}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-text-muted">
          {t("Cada quadro: tempo da primeira resposta (metade das conversas) e quantas conversas chegaram. Verde até 15 min, amarelo até 1 hora, vermelho acima.")}
        </p>
      </Bloco>

      <div className="grid gap-5 md:grid-cols-2">
        <Bloco titulo={t("De onde vieram os clientes")} id="origem">
          <Origem dados={dados} c={c} />
          <p className="text-xs text-text-muted">
            {t("A origem sai da primeira mensagem e do clique no anúncio, quando o WhatsApp o informa.")}
          </p>
        </Bloco>
        <Bloco titulo={t("O que eles perguntaram")} id="assuntos">
          <Barras
            tag={tag}
            total={1}
            itens={dados.assuntos.map((a) => ({ rotulo: t(a.rotulo), valor: a.proporcao, texto: proporcaoParaLer(a.proporcao) }))}
          />
          <p className="text-xs text-text-muted">{t("Uma conversa pode ter mais de um assunto.")}</p>
        </Bloco>
      </div>

      <Bloco titulo={t("Como as conversas terminaram")} id="desfecho">
        <Barras
          tag={tag}
          total={dados.numeros.conversas}
          itens={dados.desfechos.map((d) => ({ rotulo: t(d.rotulo), valor: d.conversas, tom: d.tom, texto: String(d.conversas) }))}
        />
        {dados.anuncio.conversas > 0 ? (
          <p className="text-sm text-text-muted">
            {t("Das {n} conversas que vieram de anúncio: {a} agendaram e {s} ficaram sem resposta.")
              .replace("{n}", String(dados.anuncio.conversas))
              .replace("{a}", String(dados.anuncio.agendaram))
              .replace("{s}", String(dados.anuncio.semResposta))}
          </p>
        ) : null}
      </Bloco>

      <Bloco titulo={t("Nota do atendimento")} id="nota">
        <p className="text-sm">
          <b className="text-2xl">{notaParaLer(dados.notas.media, tag)}</b>{" "}
          <span className="text-text-muted">
            {t("de 10, média das {n} conversas analisadas").replace("{n}", String(dados.notas.analisadas))}
          </span>
        </p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {CRITERIOS.map((k) => (
            <Numero key={k} valor={notaParaLer(dados.notas.porCriterio[k], tag)} rotulo={t(ROTULO_DO_CRITERIO[k])} />
          ))}
        </div>
        <p className="text-xs text-text-muted">
          {t("A rapidez sai do relógio; as outras quatro notas, da leitura de cada conversa. O que se procura muda com o segmento.")}
        </p>
      </Bloco>

      <Bloco titulo={t("Conversas de exemplo")} id="exemplos">
        <div className="grid gap-4 md:grid-cols-2">
          {[...dados.exemplos.bons, ...dados.exemplos.ruins].map((e) => (
            <div key={`${e.ordem}-${e.tom}`} className="space-y-2 rounded-lg border border-border p-3" data-raio-x-exemplo={e.ordem}>
              <div className="flex items-center justify-between gap-2 text-sm">
                <b>{t("Cliente {n}").replace("{n}", e.ordem)}</b>
                <span className={`rounded-full px-2 py-0.5 text-xs ${CLASSE_DO_TOM[e.tom]}`}>{t(e.desfechoRotulo)}</span>
              </div>
              {e.baloes.map((b, i) => (
                <div
                  key={i}
                  className={`max-w-[90%] rounded-lg px-3 py-2 text-sm ${b.daLoja ? "ml-auto bg-primary/10" : "bg-surface-elevated"}`}
                >
                  {b.audio ? <span className="text-text-muted">{t("(áudio)")} </span> : null}
                  {b.texto}
                  <div className="text-xs text-text-muted">
                    {t(ROTULO_DO_DIA[diaValido(b.dia)])} {b.hora}
                  </div>
                </div>
              ))}
              {e.comentario ? <p className="text-xs text-text-muted">{e.comentario}</p> : null}
            </div>
          ))}
        </div>
        <p className="text-xs text-text-muted">
          {t("Escolhidas automaticamente pela nota. Revise antes de mandar o link ao dono: os nomes viram [nome], mas um sobrenome raro pode escapar.")}
        </p>
      </Bloco>

      <Bloco titulo={t("O que melhorar, em ordem")} id="recomendacoes">
        {dados.recomendacoes.length === 0 ? (
          <p className="text-sm text-text-muted">{t("Nenhum ponto crítico nos números deste período.")}</p>
        ) : (
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            {dados.recomendacoes.map((r) => {
              const x = textoDaRecomendacao(r, c);
              return (
                <li key={r.codigo}>
                  <b>{x.titulo}</b> {x.corpo}
                </li>
              );
            })}
          </ol>
        )}
      </Bloco>

      {/* FORK MIA (.102): para quem já é cliente, o bloco é "onde ainda dá para ganhar" (acima). */}
      {ativo ? null : (
      <Bloco titulo={t("Para a conversa comercial da Time")} id="mia">
        <p className="text-sm">
          {t("O que o agente da MIA resolveria aqui: resposta em segundos a qualquer hora, retorno automático para quem sumiu e a passagem para a equipe só quando o cliente quer o próximo passo.")}{" "}
          <b>
            {t("Estimativa: {n} das {total} conversas ({s} sem resposta e {r} que sumiram sem retorno) teriam tido resposta ou retorno.")
              .replace("{n}", String(dados.mia.conversasComRespostaOuRetorno))
              .replace("{total}", String(dados.numeros.conversas))
              .replace("{s}", String(dados.mia.semResposta))
              .replace("{r}", String(dados.mia.sumiramSemRetorno))}
          </b>
        </p>
        <p className="text-xs text-text-muted">{t("Este bloco aparece só no relatório da Time, nunca no link do dono.")}</p>
      </Bloco>
      )}

      <Bloco titulo={t("Sobre esta análise")} id="sobre">
        <p className="text-sm text-text-muted">
          {t("{c} conversas · {m} mensagens · {a} áudios transcritos · {f} fotos, {v} vídeos e {d} documentos só contados")
            .replace("{c}", String(dados.numeros.conversas))
            .replace("{m}", String(dados.numeros.mensagens))
            .replace("{a}", String(dados.numeros.audiosTranscritos))
            .replace("{f}", String(dados.numeros.fotos))
            .replace("{v}", String(dados.numeros.videos))
            .replace("{d}", String(dados.numeros.documentos))}
        </p>
        <p className="text-sm">
          {t("Custo da análise:")} <b data-raio-x="custo">{reais.format(custoCentavos / 100)}</b> · {t("versão dos critérios")} {dados.criteriosVersao} ·{" "}
          {t("período")} {dataCurta(dados.periodo.inicio, tag)} {t("a")} {dataCurta(dados.periodo.fim, tag)}
        </p>
        {dados.analise.parcial ? (
          <p className="rounded-md bg-warning-bg p-3 text-sm text-warning-fg" data-raio-x="parcial">
            {t("O teto de custo foi atingido: {n} conversas ficaram fora da leitura por IA (origem, assunto, desfecho e nota). Os tempos de resposta contam todas.").replace(
              "{n}",
              String(dados.analise.foraDoTeto),
            )}
          </p>
        ) : null}
      </Bloco>
    </div>
  );
}

export function RelatorioDoDono({
  dados,
  comparacao,
  t,
  tag,
}: {
  dados: DadosDoDono;
  comparacao: Comparacao | null;
  t: T;
  tag: string;
}) {
  const c = { t, tag };
  const pontos = dados.recomendacoes.slice(0, 3).map((r) => textoDaRecomendacao(r, c));
  if (dados.clienteAtivo) return <RelatorioDoDonoClienteAtivo dados={dados} bloco={dados.clienteAtivo} comparacao={comparacao} c={c} />;
  return (
    <div className="space-y-5" data-raio-x="dono">
      <div className="space-y-1">
        <p className="text-sm text-text-muted">
          {t("Raio-X do atendimento · últimos {n} dias · preparado pela Time Company").replace("{n}", String(dados.periodo.dias))}
        </p>
        <h1 className="text-xl font-semibold">
          {t("{empresa}: {n} clientes chamaram no WhatsApp. {m} ficaram sem resposta ou sem retorno.")
            .replace("{empresa}", dados.empresa)
            .replace("{n}", String(dados.numeros.conversas))
            .replace("{m}", String(dados.semRespostaOuRetorno))}
        </h1>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Numero valor={tempoDe(dados.tempo, "geral")} rotulo={t("metade responde em até")} />
        <Numero valor={tempoDe(dados.tempo, "fechada")} rotulo={t("com a loja fechada")} />
        <Numero valor={String(dados.tempo.semResposta)} rotulo={t("sem nenhuma resposta")} />
        <Numero valor={proporcaoParaLer(dados.indicadores.proporcaoAgendou)} rotulo={t("agendaram o próximo passo")} />
      </div>
      {pontos.length > 0 ? (
        <Bloco titulo={t("Os pontos que mais pesam")} id="pontos">
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            {pontos.map((p) => (
              <li key={p.titulo}>
                <b>{p.titulo}</b> {p.corpo}
              </li>
            ))}
          </ol>
        </Bloco>
      ) : null}
      {comparacao ? (
        <Bloco titulo={`${t("Desde o raio-X de")} ${dataCurta(comparacao.anteriorEm, tag)}`} id="evolucao">
          <Evolucao comparacao={comparacao} c={c} />
        </Bloco>
      ) : null}
      <Bloco titulo={t("De onde vêm os seus clientes")} id="origem">
        <Origem dados={dados} c={c} />
      </Bloco>
      <Bloco titulo={t("Próximo passo")} id="proximo-passo">
        <p className="text-sm">
          {t("A Time Company vai te mostrar como responder em segundos a qualquer hora e voltar a chamar quem sumiu, sem aumentar a equipe.")}
        </p>
      </Bloco>
    </div>
  );
}

/**
 * FORK MIA (.102) · o que o DONO do cliente ativo recebe (protótipo de
 * 05/11/2026, tela 7): o resultado da MIA e onde a equipe ainda perde. O mesmo
 * link sem login, sem custo e sem as anotações da Time.
 */
function RelatorioDoDonoClienteAtivo({
  dados,
  bloco,
  comparacao,
  c,
}: {
  dados: DadosDoDono;
  bloco: BlocoDoClienteAtivo;
  comparacao: Comparacao | null;
  c: Comum;
}) {
  const { t, tag } = c;
  const q = bloco.quemRespondeu;
  const ia = q.linhas.find((l) => l.quem === "ia");
  const linha = (k: Indicador) => comparacao?.linhas.find((l) => l.indicador === k) ?? null;
  const semResposta = linha("proporcaoSemResposta");
  const nota = linha("notaMedia");
  const contra = comparacao && comparacao.anteriorFonte !== "conversas_da_mia" && semResposta?.anterior !== null && semResposta?.agora !== null;
  const primeiro =
    semResposta && semResposta.anterior !== null && semResposta.agora !== null
      ? (semResposta.agora <= semResposta.anterior ? t("cliente sem resposta caiu de {a} para {b}") : t("cliente sem resposta subiu de {a} para {b}"))
          .replace("{a}", proporcaoParaLer(semResposta.anterior))
          .replace("{b}", proporcaoParaLer(semResposta.agora))
      : null;
  const segundo =
    nota && nota.aviso === null && nota.anterior !== null && nota.agora !== null
      ? (nota.agora >= nota.anterior ? t("a nota do atendimento subiu de {a} para {b}") : t("a nota do atendimento caiu de {a} para {b}"))
          .replace("{a}", notaParaLer(nota.anterior, tag))
          .replace("{b}", notaParaLer(nota.agora, tag))
      : null;
  return (
    <div className="space-y-5" data-raio-x="dono" data-raio-x-fonte-do-relatorio="conversas_da_mia">
      <p className="text-sm text-text-muted">
        {t("Raio-X do atendimento · {empresa} · {periodo}").replace("{empresa}", dados.empresa).replace("{periodo}", periodoParaLer(dados.periodo, t, tag, true))}
      </p>
      <ul className="space-y-2 text-base">
        <li>
          <b>
            {t("{n} clientes chamaram no WhatsApp em {d} dias.").replace("{n}", String(dados.numeros.conversas)).replace("{d}", String(dados.periodo.dias))}
          </b>{" "}
          {t("{p} foram respondidos, {q} pela MIA em {t}.")
            .replace("{p}", percentual(q.respondidas, q.conversas))
            .replace("{q}", percentual(ia?.conversas ?? 0, q.conversas))
            .replace("{t}", segundosParaLer(ia?.medianaSeg ?? null))}
        </li>
        {ia && ia.foraDoHorario > 0 ? <li>{t("A MIA respondeu {n} clientes que chamaram à noite ou no fim de semana.").replace("{n}", String(ia.foraDoHorario))}</li> : null}
        {bloco.funil.passadas > 0 ? (
          <li>
            {t("{n} conversas foram passadas para a sua equipe, e {v} viraram venda.").replace("{n}", String(bloco.funil.passadas)).replace("{v}", String(bloco.funil.venda))}
          </li>
        ) : null}
        {bloco.passagem.lentas > 0 ? (
          <li>
            <b>
              {t("Onde a equipe pode ganhar: {n} clientes esperaram mais de 2 horas depois da passagem, ou ninguém assumiu.").replace("{n}", String(bloco.passagem.lentas))}
            </b>
          </li>
        ) : null}
        {contra && primeiro ? (
          <li>
            {(segundo ? t("Comparado com o raio-X de {data}, antes da MIA: {primeiro}, e {segundo}.") : t("Comparado com o raio-X de {data}, antes da MIA: {primeiro}."))
              .replace("{data}", dataCurta(comparacao!.anteriorEm, tag))
              .replace("{primeiro}", primeiro)
              .replace("{segundo}", segundo ?? "")}
          </li>
        ) : null}
      </ul>
      <p className="text-xs text-text-muted">{t("Trechos de conversa sem nome, telefone ou documento.")}</p>
      <OndeGanhar bloco={bloco} c={c} titulo={t("Onde a equipe pode ganhar")} />
      {comparacao ? (
        <Bloco titulo={`${t("Desde o raio-X de")} ${dataCurta(comparacao.anteriorEm, tag)}`} id="evolucao">
          <Evolucao comparacao={comparacao} c={c} />
        </Bloco>
      ) : null}
      <Bloco titulo={t("De onde vêm os seus clientes")} id="origem">
        <Origem dados={dados} c={c} />
      </Bloco>
    </div>
  );
}
