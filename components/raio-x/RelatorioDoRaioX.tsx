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
 */
import type { Comparacao, Indicador } from "@/lib/raio-x/comparacao";
import { ROTULO_DO_INDICADOR } from "@/lib/raio-x/comparacao";
import type { DadosDoDono, DadosDoRelatorio, Recomendacao } from "@/lib/raio-x/relatorio";
import { CRITERIOS, ROTULO_DO_CRITERIO } from "@/lib/raio-x/segmentos";

import {
  CLASSE_DO_TOM,
  DIAS,
  FAIXAS,
  ROTULO_DA_FAIXA,
  ROTULO_DO_DIA,
  diaValido,
  faixaValida,
  minutosParaLer,
  notaParaLer,
  proporcaoParaLer,
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

function Numero({ valor, rotulo }: { valor: string; rotulo: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-2xl font-semibold tabular-nums">{valor}</div>
      <div className="text-sm text-text-muted">{rotulo}</div>
    </div>
  );
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
  return minutosParaLer(v);
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
  }
}

function Evolucao({ comparacao, c }: { comparacao: Comparacao; c: Comum }) {
  const { t, tag } = c;
  const rotuloDaDirecao = (d: string | null, aviso: string | null) => {
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
              <th className="py-1 pr-3 font-medium">{t("Raio-X de")} {dataCurta(comparacao.anteriorEm, tag)}</th>
              <th className="py-1 pr-3 font-medium">{t("Agora")}</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {comparacao.linhas.map((l) => (
              <tr key={l.indicador} className="border-t border-border" data-raio-x-evolucao={l.indicador}>
                <td className="py-2 pr-3">{t(ROTULO_DO_INDICADOR[l.indicador])}</td>
                <td className="py-2 pr-3 tabular-nums">{valorDoIndicador(l.indicador, l.anterior, tag)}</td>
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
  return (
    <div className="space-y-5" data-raio-x="relatorio">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Numero valor={String(dados.numeros.conversas)} rotulo={t("conversas de clientes")} />
        <Numero valor={minutosParaLer(dados.tempo.medianaPrimeiraRespostaMin)} rotulo={t("metade responde em até")} />
        <Numero valor={proporcaoParaLer(dados.tempo.proporcaoSemResposta)} rotulo={t("ficaram sem resposta")} />
        <Numero valor={proporcaoParaLer(dados.indicadores.proporcaoAgendou)} rotulo={t("agendaram o próximo passo")} />
        <Numero valor={notaParaLer(dados.notas.media, tag)} rotulo={t("nota do atendimento")} />
      </div>

      {comparacao ? (
        <Bloco titulo={`${t("Evolução desde o raio-X de")} ${dataCurta(comparacao.anteriorEm, tag)}`} id="evolucao">
          <Evolucao comparacao={comparacao} c={c} />
        </Bloco>
      ) : null}

      <Bloco titulo={t("Velocidade da primeira resposta")} id="velocidade">
        <p className="text-sm text-text-muted">
          {t("Com a loja aberta, metade das conversas tem a primeira resposta em {a}. Com a loja fechada, em {b}; {p} das conversas chegam nessa hora.")
            .replace("{a}", minutosParaLer(dados.tempo.medianaComALojaAbertaMin))
            .replace("{b}", minutosParaLer(dados.tempo.medianaComALojaFechadaMin))
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
        <Numero valor={minutosParaLer(dados.tempo.medianaPrimeiraRespostaMin)} rotulo={t("metade responde em até")} />
        <Numero valor={minutosParaLer(dados.tempo.medianaComALojaFechadaMin)} rotulo={t("com a loja fechada")} />
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
