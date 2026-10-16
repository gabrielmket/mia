/**
 * FORK MIA (item 8) — os cartões dos doze painéis prontos.
 *
 * Componente SÓ de desenho, sem estado e sem hook: a tela `/app/paineis` (da
 * sessão) e a página pública `/painel/<token>` (do link do dono) usam o mesmo,
 * e as duas são componentes de servidor. Por isso o `t` chega por parâmetro.
 *
 * Os números já vêm somados do banco (`lib/paineis/calcular.ts` por cima de
 * `fn_mia_relatorio`); aqui só se escolhe o formato. As barras são CSS, como as
 * do funil de Desempenho (`app/app/metrics/_components/MetricsClient.tsx`):
 * barra horizontal com rótulo legível em 360 px, sem biblioteca de gráfico.
 */
import Link from "next/link";
import type { ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DadosDoPainel, LinhaRotulada, PainelCalculado, PaineisCalculados } from "@/lib/paineis/calcular";
import { formatValorDoNegocio } from "@/lib/money";

type T = (texto: string) => string;

export interface FormatoDosPaineis {
  t: T;
  /** Etiqueta BCP-47 (`tagDeIdioma`), para número e mês. */
  tag: string;
  moeda: string;
}

function inteiro(n: number, f: FormatoDosPaineis): string {
  return new Intl.NumberFormat(f.tag, { maximumFractionDigits: 0 }).format(n);
}

function porcento(n: number | null, f: FormatoDosPaineis): string {
  if (n === null) return "—";
  return `${new Intl.NumberFormat(f.tag, { maximumFractionDigits: 0 }).format(n)}%`;
}

function dinheiro(cents: number | null, f: FormatoDosPaineis): string {
  if (cents === null) return "—";
  return formatValorDoNegocio(cents, f.moeda, { semCentavos: true });
}

/** Segundos em "12 s", "7 min", "1 h 20 min". */
export function tempoDeEspera(segundos: number | null, t: T): string {
  if (segundos === null) return "—";
  if (segundos < 60) return `${Math.round(segundos)} s`;
  const minutos = Math.round(segundos / 60);
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (horas >= 48) return `${Math.round(horas / 24)} ${t("dias")}`;
  return resto > 0 ? `${horas} h ${resto} min` : `${horas} h`;
}

/** "2026-11" em "nov. de 2026" no idioma de quem lê. */
function mesPorExtenso(chave: string, f: FormatoDosPaineis): string {
  const m = /^(\d{4})-(\d{2})$/.exec(chave);
  if (!m) return chave;
  const data = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 15));
  return new Intl.DateTimeFormat(f.tag, { month: "long", year: "numeric", timeZone: "UTC" }).format(data);
}

function Barra({ valor, maximo, tom = "primario" }: { valor: number; maximo: number; tom?: "primario" | "perda" | "neutro" }) {
  const largura = maximo > 0 ? Math.max(0, Math.min(100, (valor / maximo) * 100)) : 0;
  const cor = tom === "perda" ? "bg-error" : tom === "neutro" ? "bg-text-muted" : "bg-primary";
  return (
    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
      <div className={`h-full rounded-full ${cor}`} style={{ width: `${largura}%` }} />
    </div>
  );
}

function LinhaDeBarra({
  rotulo,
  valor,
  maximo,
  texto,
  tom,
}: {
  rotulo: string;
  valor: number;
  maximo: number;
  texto: string;
  tom?: "primario" | "perda" | "neutro";
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate">{rotulo}</span>
        <span className="shrink-0 tabular-nums text-text-muted">{texto}</span>
      </div>
      <Barra valor={valor} maximo={maximo} tom={tom} />
    </div>
  );
}

function Destaque({ numero, legenda }: { numero: string; legenda: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-3xl font-semibold tabular-nums leading-tight">{numero}</span>
      <span className="text-sm text-text-muted">{legenda}</span>
    </div>
  );
}

function Numeros({ itens }: { itens: Array<{ rotulo: string; valor: string }> }) {
  return (
    <dl className="grid grid-cols-3 gap-2">
      {itens.map((i) => (
        <div key={i.rotulo} className="flex min-w-0 flex-col rounded-md bg-surface-elevated p-2">
          <dt className="truncate text-xs text-text-muted">{i.rotulo}</dt>
          <dd className="text-base font-semibold tabular-nums">{i.valor}</dd>
        </div>
      ))}
    </dl>
  );
}

function Nota({ children }: { children: ReactNode }) {
  return <p className="text-xs text-text-muted">{children}</p>;
}

function rotuloDaLinha(l: LinhaRotulada, t: T): string {
  return l.traduzir ? t(l.rotulo) : l.rotulo;
}

/** O "Sem …" fica no motor sempre; no cartão, só quando tem alguém nele. */
function visiveis<L extends LinhaRotulada>(linhas: L[]): L[] {
  return linhas.filter((l) => l.n > 0);
}

function Vazio({ t }: { t: T }) {
  return <p className="text-sm text-text-muted">{t("Nada no período.")}</p>;
}

function CorpoDoPainel({
  dados,
  calculados,
  f,
}: {
  dados: DadosDoPainel;
  calculados: Pick<PaineisCalculados, "valores" | "funil">;
  f: FormatoDosPaineis;
}) {
  const { t } = f;
  const vocab = calculados.funil?.vocabulario ?? {};
  switch (dados.tipo) {
    case "resultado": {
      const rotuloGanho = vocab.won ?? t("Ganhos");
      const rotuloPerda = vocab.lost ?? t("Perdidos");
      if (dados.ganhos + dados.perdidos + dados.abertos === 0) return <Vazio t={t} />;
      return (
        <div className="flex flex-col gap-3">
          {calculados.valores && dados.valorGanho !== null ? (
            <Destaque numero={dinheiro(dados.valorGanho, f)} legenda={t("em negócios ganhos")} />
          ) : (
            <Destaque numero={inteiro(dados.ganhos, f)} legenda={rotuloGanho} />
          )}
          <Numeros
            itens={[
              { rotulo: rotuloGanho, valor: inteiro(dados.ganhos, f) },
              { rotulo: rotuloPerda, valor: inteiro(dados.perdidos, f) },
              { rotulo: t("Taxa de ganho"), valor: porcento(dados.taxaDeGanho, f) },
            ]}
          />
          {dados.diasAteFechar !== null ? (
            <Nota>
              {t("Do primeiro contato ao fechamento, em média:")} {inteiro(dados.diasAteFechar, f)} {t("dias")}
            </Nota>
          ) : null}
          {calculados.valores && dados.foraDaMoeda > 0 ? (
            <Nota>
              {inteiro(dados.foraDaMoeda, f)} {t("negócio(s) em outra moeda ficaram fora da soma.")}
            </Nota>
          ) : null}
        </div>
      );
    }
    case "meta": {
      if (!dados.temMeta) {
        return <Nota>{t("Nenhuma meta cadastrada para este mês.")}</Nota>;
      }
      const p = dados.fracao !== null ? Math.round(dados.fracao * 100) : null;
      const corrido = dados.corrido !== null ? Math.round(dados.corrido * 100) : null;
      const noRitmo = p !== null && corrido !== null && p >= corrido;
      return (
        <div className="flex flex-col gap-3">
          {calculados.valores && dados.alvo !== null ? (
            <Destaque
              numero={dinheiro(dados.realizado, f)}
              legenda={`${t("de")} ${dinheiro(dados.alvo, f)}`}
            />
          ) : (
            <Destaque numero={porcento(p, f)} legenda={t("da meta do mês")} />
          )}
          <Barra valor={Math.min(p ?? 0, 100)} maximo={100} />
          {p !== null && corrido !== null ? (
            <Nota>
              {porcento(p, f)} {t("da meta com")} {porcento(corrido, f)} {t("do mês corrido.")}{" "}
              {noRitmo ? t("No ritmo para bater.") : t("Abaixo do ritmo.")}
            </Nota>
          ) : null}
        </div>
      );
    }
    case "funil": {
      if (dados.etapas.length === 0) return <Vazio t={t} />;
      const primeiro = dados.etapas[0]?.chegaram ?? 0;
      if (primeiro === 0) return <Vazio t={t} />;
      return (
        <div className="flex flex-col gap-2">
          {dados.etapas.map((e, i) => (
            <div key={e.chave} className="flex flex-col gap-1">
              <LinhaDeBarra rotulo={e.nome} valor={e.chegaram} maximo={primeiro} texto={inteiro(e.chegaram, f)} />
              {i < dados.etapas.length - 1 && e.seguemAdiante !== null ? (
                <span className="text-xs text-text-muted">
                  {porcento(e.seguemAdiante, f)} {t("seguem adiante")}
                </span>
              ) : null}
            </div>
          ))}
          <Nota>{t("Quantos chegaram a cada etapa, dos que entraram ou fecharam no período.")}</Nota>
        </div>
      );
    }
    case "origem": {
      const linhas = visiveis(dados.linhas);
      if (linhas.length === 0) return <Vazio t={t} />;
      const maximo = Math.max(...linhas.map((l) => l.n), 1);
      return (
        <div className="flex flex-col gap-2">
          {linhas.map((l) => (
            <LinhaDeBarra
              key={l.chave}
              rotulo={rotuloDaLinha(l, t)}
              valor={l.n}
              maximo={maximo}
              texto={`${inteiro(l.n, f)} · ${inteiro(l.fecharam, f)} ${t("fecharam")}`}
            />
          ))}
          <Nota>{t("Quantos chegaram de cada origem, e quantos viraram venda.")}</Nota>
        </div>
      );
    }
    case "perdas": {
      const linhas = visiveis(dados.linhas);
      if (linhas.length === 0) return <Vazio t={t} />;
      const maximo = Math.max(...linhas.map((l) => l.n), 1);
      return (
        <div className="flex flex-col gap-2">
          {linhas.map((l) => (
            <LinhaDeBarra
              key={l.chave}
              rotulo={rotuloDaLinha(l, t)}
              valor={l.n}
              maximo={maximo}
              texto={inteiro(l.n, f)}
              tom="perda"
            />
          ))}
          <Nota>
            {inteiro(dados.total, f)} {t("negócio(s) perdido(s) no período.")}
          </Nota>
        </div>
      );
    }
    case "atendimento": {
      if (dados.total === 0) return <Vazio t={t} />;
      return (
        <div className="flex flex-col gap-3">
          <Destaque numero={porcento(dados.resolvidas, f)} legenda={t("das conversas resolvidas pelo agente")} />
          <Numeros
            itens={[
              { rotulo: t("Agente"), valor: inteiro(dados.agente, f) },
              { rotulo: t("Equipe"), valor: inteiro(dados.equipe, f) },
              { rotulo: t("Sem resposta"), valor: inteiro(dados.semResposta, f) },
            ]}
          />
          <Nota>
            {inteiro(dados.total, f)} {t("conversa(s) com mensagem do cliente no período.")}
          </Nota>
        </div>
      );
    }
    case "resposta": {
      if (dados.conversas === 0) return <Vazio t={t} />;
      return (
        <div className="flex flex-col gap-3">
          <Numeros
            itens={[
              { rotulo: t("Agente"), valor: tempoDeEspera(dados.agente, t) },
              { rotulo: t("Equipe (metade)"), valor: tempoDeEspera(dados.equipeMetade, t) },
              { rotulo: t("Equipe (9 em 10)"), valor: tempoDeEspera(dados.equipeNoveEmDez, t) },
            ]}
          />
          <Nota>
            {t("Tempo até a primeira resposta. \"Metade\" quer dizer que metade dos clientes esperou até esse tempo.")}
          </Nota>
        </div>
      );
    }
    case "agenda": {
      if (dados.marcadas + dados.desmarcadas === 0) return <Vazio t={t} />;
      const maximo = Math.max(dados.marcadas, 1);
      return (
        <div className="flex flex-col gap-3">
          <Destaque numero={inteiro(dados.realizadas, f)} legenda={t("realizados")} />
          <div className="flex flex-col gap-2">
            <LinhaDeBarra rotulo={t("Marcados")} valor={dados.marcadas} maximo={maximo} texto={inteiro(dados.marcadas, f)} />
            <LinhaDeBarra rotulo={t("Confirmados")} valor={dados.confirmadas} maximo={maximo} texto={inteiro(dados.confirmadas, f)} />
            <LinhaDeBarra rotulo={t("Realizados")} valor={dados.realizadas} maximo={maximo} texto={inteiro(dados.realizadas, f)} />
            <LinhaDeBarra rotulo={t("Faltas")} valor={dados.faltas} maximo={maximo} texto={inteiro(dados.faltas, f)} tom="perda" />
          </div>
          <Nota>
            {porcento(dados.taxaDeFaltas, f)} {t("de faltas entre os que já aconteceram.")}
            {dados.desmarcadas > 0 ? ` ${inteiro(dados.desmarcadas, f)} ${t("desmarcado(s).")}` : ""}
          </Nota>
        </div>
      );
    }
    case "followup": {
      if (dados.receberam === 0) return <Vazio t={t} />;
      const maximo = Math.max(dados.receberam, 1);
      return (
        <div className="flex flex-col gap-3">
          <Destaque numero={porcento(dados.taxa, f)} legenda={t("voltaram a responder")} />
          <div className="flex flex-col gap-2">
            <LinhaDeBarra rotulo={t("Receberam")} valor={dados.receberam} maximo={maximo} texto={inteiro(dados.receberam, f)} />
            <LinhaDeBarra rotulo={t("Responderam")} valor={dados.responderam} maximo={maximo} texto={inteiro(dados.responderam, f)} />
            <LinhaDeBarra rotulo={t("Viraram venda")} valor={dados.viraramVenda} maximo={maximo} texto={inteiro(dados.viraramVenda, f)} />
            <LinhaDeBarra
              rotulo={t("Pediram para parar")}
              valor={dados.pediramParaParar}
              maximo={maximo}
              texto={inteiro(dados.pediramParaParar, f)}
              tom="neutro"
            />
          </div>
        </div>
      );
    }
    case "anuncios": {
      if (dados.plataformas.length === 0) return <Vazio t={t} />;
      return (
        <div className="flex flex-col gap-2">
          {dados.plataformas.map((p) => (
            <LinhaDeBarra
              key={p.chave}
              rotulo={t(p.rotulo)}
              valor={p.aceitos}
              maximo={Math.max(p.informados, 1)}
              texto={`${inteiro(p.aceitos, f)} ${t("de")} ${inteiro(p.informados, f)}`}
            />
          ))}
          <Nota>
            {t("Eventos aceitos pela plataforma, do total que o sistema informou (lead qualificado, etapa do funil e venda).")}
          </Nota>
        </div>
      );
    }
    case "previsao": {
      if (dados.abertos === 0) return <Vazio t={t} />;
      const maximo = Math.max(...dados.meses.map((m) => m.previsto ?? m.n), 1);
      return (
        <div className="flex flex-col gap-3">
          {calculados.valores && dados.previsto !== null ? (
            <Destaque numero={dinheiro(dados.previsto, f)} legenda={t("previstos, pesados pela chance da etapa")} />
          ) : (
            <Destaque numero={inteiro(dados.abertos, f)} legenda={t("negócios abertos com chance de fechar")} />
          )}
          <div className="flex flex-col gap-2">
            {dados.meses.map((m) => (
              <LinhaDeBarra
                key={m.chave}
                rotulo={m.chave === "__sem" ? t("Sem data prevista") : mesPorExtenso(m.chave, f)}
                valor={calculados.valores && m.previsto !== null ? m.previsto : m.n}
                maximo={maximo}
                texto={calculados.valores && m.previsto !== null ? dinheiro(m.previsto, f) : inteiro(m.n, f)}
              />
            ))}
          </div>
          <Nota>{t("Soma dos negócios abertos, cada um pesado pela chance da etapa em que está.")}</Nota>
          {dados.semProbabilidade > 0 ? (
            <Nota>
              {inteiro(dados.semProbabilidade, f)} {t("negócio(s) em etapa sem chance calibrada ficaram fora da soma.")}
            </Nota>
          ) : null}
        </div>
      );
    }
    case "assuntos": {
      const linhas = visiveis(dados.linhas);
      if (linhas.length === 0) return <Vazio t={t} />;
      const maximo = Math.max(...linhas.map((l) => l.n), 1);
      return (
        <div className="flex flex-col gap-2">
          {linhas.map((l) => (
            <LinhaDeBarra key={l.chave} rotulo={rotuloDaLinha(l, t)} valor={l.n} maximo={maximo} texto={inteiro(l.n, f)} />
          ))}
          <Nota>{t("Conversas por etiqueta. Uma conversa com duas etiquetas conta nas duas.")}</Nota>
        </div>
      );
    }
  }
}

export function CartaoDoPainel({
  painel,
  calculados,
  f,
  acao,
}: {
  painel: PainelCalculado;
  calculados: Pick<PaineisCalculados, "valores" | "funil">;
  f: FormatoDosPaineis;
  /** Um link no rodapé do cartão (só dentro do sistema: "Ver a análise do funil"). */
  acao?: { href: string; rotulo: string } | null;
}) {
  const { t } = f;
  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader className="gap-1 p-4 pb-2">
        <CardTitle className="text-base">{painel.tituloEDado ? painel.titulo : t(painel.titulo)}</CardTitle>
        <p className="text-xs text-text-muted">{t(painel.pergunta)}</p>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 p-4 pt-2">
        {painel.restrito === "so_gestor" ? (
          <Nota>{t("Só gestor e administrador veem o que foi informado aos anúncios.")}</Nota>
        ) : painel.erro ? (
          <Nota>{t("Não deu para calcular este painel agora. Tente de novo em instantes.")}</Nota>
        ) : painel.dados ? (
          <CorpoDoPainel dados={painel.dados} calculados={calculados} f={f} />
        ) : null}
        {acao ? (
          <Link
            href={acao.href}
            className="mt-auto inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline lg:min-h-0"
          >
            {acao.rotulo}
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function GradeDePaineis({
  calculados,
  f,
  acoes,
}: {
  calculados: PaineisCalculados;
  f: FormatoDosPaineis;
  acoes?: Partial<Record<PainelCalculado["chave"], { href: string; rotulo: string }>>;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {calculados.paineis.map((p) => (
        <CartaoDoPainel key={p.chave} painel={p} calculados={calculados} f={f} acao={acoes?.[p.chave] ?? null} />
      ))}
    </div>
  );
}
