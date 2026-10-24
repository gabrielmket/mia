"use client";

/**
 * FORK MIA (.89) — a tela de Configurações › E-mail marketing (protótipo
 * aprovado em 24/10/2026, tela 1 "Configurar o envio", e a lista de supressão
 * da tela 6).
 *
 * O administrador muda; o gestor vê tudo, sem mudar (os campos ficam
 * desligados e a tela diz por quê). Sem as chaves da Amazon no servidor, a tela
 * diz quais faltam e quem as coloca.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import {
  useAcrescentarSupressao,
  useArquivarRemetente,
  useGravarConfiguracao,
  useGravarRemetente,
  useGravarTexto,
  useImportarAceites,
  useImportarSupressao,
  useRetratoDoEmail,
  useSupressao,
  useVerificarDominio,
  type Retrato,
} from "@/hooks/useEmailMarketing";
import { copyToClipboard } from "@/lib/clipboard";
import { ROTULO_DA_SUPRESSAO } from "@/lib/email-marketing/rotulos";
import { JANELAS_DE_ENVIO, RITMOS_POR_HORA } from "@/lib/email-marketing/regras";
import { formatCentsBRL } from "@/lib/money";

const TOQUE = "min-h-11 lg:min-h-0";

function Secao({
  titulo,
  children,
  className = "",
}: {
  titulo: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={`space-y-3 p-4 ${className}`}>
      <h2 className="text-base font-semibold">{titulo}</h2>
      {children}
    </Card>
  );
}

function Medidor({
  rotulo,
  valor,
  trava,
  limite,
  maximo,
  nota,
}: {
  rotulo: string;
  valor: number;
  trava: number;
  limite: number;
  maximo: number;
  nota: string;
}) {
  const largura = Math.min(100, (valor * 100) / maximo);
  const cor = valor >= limite ? "bg-error" : valor >= trava ? "bg-warning" : "bg-success";
  const fmt = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span>{rotulo}</span>
        <b>{fmt(valor)}</b>
      </div>
      <div
        className="relative h-2 rounded-full bg-surface-elevated"
        role="img"
        aria-label={`${rotulo} ${fmt(valor)}`}
      >
        <i
          className={`absolute inset-y-0 left-0 rounded-full ${cor}`}
          style={{ width: `${largura}%` }}
        />
        <span
          className="absolute inset-y-[-3px] w-px bg-warning-fg"
          style={{ left: `${(trava * 100) / maximo}%` }}
        />
        <span
          className="absolute inset-y-[-3px] w-px bg-error-fg"
          style={{ left: `${(limite * 100) / maximo}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">{nota}</p>
    </div>
  );
}

export function ConfiguracaoDoEmailMarketing() {
  const t = useT();
  const retrato = useRetratoDoEmail();
  if (retrato.isLoading) return <p className="text-sm text-muted-foreground">{t("Carregando…")}</p>;
  if (retrato.isError || !retrato.data) {
    return (
      <Card className="space-y-2 p-4">
        <p className="text-sm text-error-fg">
          {t("Não consegui carregar a configuração do e-mail.")}
        </p>
        <Button size="sm" variant="outline" onClick={() => void retrato.refetch()}>
          {t("Tentar novamente")}
        </Button>
      </Card>
    );
  }
  const r = retrato.data;
  if (!r.modulo.contratado) {
    return (
      <Card className="space-y-2 p-4" data-email-marketing="nao-contratado">
        <h2 className="text-base font-semibold">{t("O disparo por e-mail é vendido à parte")}</h2>
        <p className="text-sm text-muted-foreground">
          {t(
            "Com o módulo, a empresa manda campanhas de e-mail para a própria base, pelo domínio dela, com descadastro de um clique e lista de supressão. O custo sai da carteira de créditos, a mesma do número oficial.",
          )}
        </p>
        <p className="text-sm text-muted-foreground">
          {t(
            "Quem libera é quem cuida da sua conta. O registro de consentimento na ficha do contato continua valendo, com ou sem o módulo.",
          )}
        </p>
      </Card>
    );
  }
  return <Configuracao r={r} />;
}

function Configuracao({ r }: { r: Retrato }) {
  const t = useT();
  const idioma = useTagDeIdioma();
  const pode = r.pode_mudar;
  const gravar = useGravarConfiguracao();
  const [form, setForm] = useState({
    responder_para: r.responder_para ?? "",
    rodape_razao_social: r.rodape.razaoSocial,
    rodape_cnpj: r.rodape.cnpj,
    rodape_endereco: r.rodape.endereco,
    rodape_motivo: r.rodape.motivo,
    rodape_privacidade_url: r.rodape.privacidadeUrl,
    rodape_usar_privacidade_padrao: r.rodape.usarPrivacidadePadrao,
    ritmo_por_hora: r.ritmo_por_hora,
    janela: `${r.janela[0]}-${r.janela[1]}`,
    so_dias_uteis: r.so_dias_uteis,
  });
  const [verPrivacidade, setVerPrivacidade] = useState(false);
  const campo =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  function salvar() {
    const [ji, jf] = form.janela.split("-").map(Number);
    gravar.mutate(
      {
        responder_para: form.responder_para.trim() || null,
        rodape_razao_social: form.rodape_razao_social,
        rodape_cnpj: form.rodape_cnpj,
        rodape_endereco: form.rodape_endereco,
        rodape_motivo: form.rodape_motivo,
        rodape_privacidade_url: form.rodape_privacidade_url.trim(),
        rodape_usar_privacidade_padrao: form.rodape_usar_privacidade_padrao,
        ritmo_por_hora: Number(form.ritmo_por_hora),
        janela_inicio: ji,
        janela_fim: jf,
        so_dias_uteis: form.so_dias_uteis,
      },
      { onSuccess: () => toast.success(t("Configuração salva.")) },
    );
  }

  return (
    <div className="space-y-4" data-email-marketing="configuracao">
      {!pode ? (
        <p className="rounded-md bg-info-bg p-3 text-sm text-info-fg">
          {t(
            "Você vê a configuração, mas só o administrador muda domínio, remetente, rodapé e ritmo.",
          )}
        </p>
      ) : null}
      {r.empresa.demonstracao ? (
        <p className="rounded-md bg-warning-bg p-3 text-sm text-warning-fg">
          {t(
            "Esta é a empresa de demonstração: tudo funciona com dados fictícios e nenhum e-mail sai, nem o teste.",
          )}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Secao titulo={t("Módulo e carteira")}>
          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t("Situação")}</dt>
            <dd>
              <Badge variant="success">{t("Contratado")}</Badge>
            </dd>
            <dt className="text-muted-foreground">{t("Preço por e-mail")}</dt>
            <dd>
              <b>{formatCentsBRL(r.preco.por_email_cents)}</b> {t("por e-mail aceito pela Amazon")}
              {r.preco.padrao ? ` (${t("o padrão")})` : ""}
            </dd>
            <dt className="text-muted-foreground">{t("Carteira")}</dt>
            <dd>
              {formatCentsBRL(r.saldo_cents)} {t("de saldo, a mesma do número oficial")}
            </dd>
            <dt className="text-muted-foreground">{t("Por onde sai")}</dt>
            <dd>
              {t("Amazon SES, região")} {r.amazon.regiao}
            </dd>
            <dt className="text-muted-foreground">{t("E-mail do sistema")}</dt>
            <dd>
              {t(
                "Convite, senha e LGPD continuam no servidor de e-mail da instalação, sem mudança.",
              )}
            </dd>
          </dl>
          {!r.amazon.configurado ? (
            <div
              className="rounded-md bg-warning-bg p-3 text-sm text-warning-fg"
              data-amazon="desligada"
            >
              <p className="font-medium">
                {t("O envio pela Amazon ainda não foi ligado no servidor.")}
              </p>
              <p>{t("Faltam estas variáveis de ambiente:")}</p>
              <ul className="list-disc pl-5 font-mono text-xs">
                {r.amazon.falta.map((v) => (
                  <li key={v}>{v}</li>
                ))}
              </ul>
              <p>
                {t(
                  "Quem coloca as chaves é quem opera a plataforma. Sem elas, nada sai e nada é cobrado.",
                )}
              </p>
            </div>
          ) : null}
        </Secao>

        <Secao titulo={t("Saúde do envio · últimos 30 dias")}>
          {r.saude_30_dias.enviados === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t(
                "Nenhum envio ainda por este domínio. Os números aparecem depois da primeira campanha.",
              )}
            </p>
          ) : (
            <div className="space-y-3">
              <Medidor
                rotulo={t("Rejeição")}
                valor={r.saude_30_dias.rejeicaoPct}
                trava={r.saude_30_dias.trava.rejeicao_pct}
                limite={r.saude_30_dias.limite_da_amazon.rejeicao_pct}
                maximo={6}
                nota={t("A trava pausa a campanha em 4%; a Amazon põe a conta em revisão em 5%.")}
              />
              <Medidor
                rotulo={t("Reclamação")}
                valor={r.saude_30_dias.reclamacaoPct}
                trava={r.saude_30_dias.trava.reclamacao_pct}
                limite={r.saude_30_dias.limite_da_amazon.reclamacao_pct}
                maximo={0.15}
                nota={t("A trava pausa em 0,08%; a Amazon revisa a conta em 0,1%.")}
              />
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {r.supressao_total.toLocaleString(idioma)} {t("endereços na lista de supressão")}
          </p>
        </Secao>
      </div>

      <Dominio r={r} pode={pode} />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Remetentes
            r={r}
            pode={pode}
            responderPara={form.responder_para}
            aoMudarResponder={campo("responder_para")}
          />
          <Secao titulo={t("Ritmo padrão")}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="em-ritmo">{t("E-mails por hora")}</Label>
                <select
                  id="em-ritmo"
                  className={`h-9 w-full rounded-md border border-border bg-surface px-2 text-sm ${TOQUE}`}
                  value={form.ritmo_por_hora}
                  onChange={campo("ritmo_por_hora")}
                  disabled={!pode}
                >
                  {RITMOS_POR_HORA.map((n) => (
                    <option key={n} value={n}>
                      {n.toLocaleString(idioma)} {t("por hora")}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="em-janela">{t("Janela de envio")}</Label>
                <select
                  id="em-janela"
                  className={`h-9 w-full rounded-md border border-border bg-surface px-2 text-sm ${TOQUE}`}
                  value={form.janela}
                  onChange={campo("janela")}
                  disabled={!pode}
                >
                  {JANELAS_DE_ENVIO.map(([a, b]) => (
                    <option key={`${a}-${b}`} value={`${a}-${b}`}>
                      {t("Das {a}h às {b}h").replace("{a}", String(a)).replace("{b}", String(b))}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <label className={`flex items-start gap-3 ${TOQUE}`}>
              <Switch
                checked={form.so_dias_uteis}
                onCheckedChange={(v) => setForm((f) => ({ ...f, so_dias_uteis: v }))}
                disabled={!pode}
              />
              <span className="text-sm">
                <b>{t("Só em dias úteis")}</b>
                <span className="block text-xs text-muted-foreground">
                  {t("No fuso da empresa. Cada campanha pode ir mais devagar, nunca mais rápido.")}
                </span>
              </span>
            </label>
          </Secao>
        </div>

        <Secao titulo={t("Rodapé com a identificação da empresa")}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="em-razao">{t("Razão social")}</Label>
              <Input
                id="em-razao"
                value={form.rodape_razao_social}
                onChange={campo("rodape_razao_social")}
                disabled={!pode}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="em-cnpj">{t("CNPJ")}</Label>
              <Input
                id="em-cnpj"
                value={form.rodape_cnpj}
                onChange={campo("rodape_cnpj")}
                disabled={!pode}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="em-endereco">{t("Endereço")}</Label>
            <Input
              id="em-endereco"
              value={form.rodape_endereco}
              onChange={campo("rodape_endereco")}
              disabled={!pode}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="em-motivo">{t("Por que a pessoa recebe")}</Label>
            <Textarea
              id="em-motivo"
              rows={2}
              value={form.rodape_motivo}
              onChange={campo("rodape_motivo")}
              disabled={!pode}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="em-privacidade">{t("Política de privacidade")}</Label>
            <Input
              id="em-privacidade"
              value={form.rodape_privacidade_url}
              onChange={campo("rodape_privacidade_url")}
              disabled={!pode}
              placeholder="https://exemplo.com.br/privacidade"
            />
          </div>
          <label className={`flex items-start gap-3 ${TOQUE}`}>
            <Switch
              checked={form.rodape_usar_privacidade_padrao}
              onCheckedChange={(v) => setForm((f) => ({ ...f, rodape_usar_privacidade_padrao: v }))}
              disabled={!pode}
            />
            <span className="text-sm">
              <b>{t("Sem página própria: usar o texto padrão de privacidade")}</b>
              <span className="block text-xs text-muted-foreground">
                {t("Ele aparece na página de preferências do e-mail.")}
              </span>
              <Badge variant="warning" className="mt-1">
                {t(r.privacidade_padrao.marca)}
              </Badge>
            </span>
          </label>
          <Button
            variant="link"
            className="h-auto p-0 text-sm"
            onClick={() => setVerPrivacidade((v) => !v)}
          >
            {verPrivacidade ? t("Esconder o texto padrão") : t("Ler o texto padrão")}
          </Button>
          {verPrivacidade ? (
            <div className="space-y-2 rounded-md border border-border p-3 text-xs text-muted-foreground">
              {r.privacidade_padrao.texto.map((p, i) => (
                <p key={i} className={i === 0 ? "font-semibold text-text" : ""}>
                  {p}
                </p>
              ))}
            </div>
          ) : null}
          <p className="text-xs font-medium">{t("Como sai em todo e-mail")}</p>
          <div
            className="rounded-md border border-border bg-surface-elevated p-3 text-xs text-muted-foreground"
            data-rodape="previa"
          >
            <p>
              <b className="text-text">{form.rodape_razao_social || t("Razão social")}</b> · CNPJ{" "}
              {form.rodape_cnpj || "?"}
            </p>
            <p>{form.rodape_endereco || t("Endereço")}</p>
            <p className="mt-2">{form.rodape_motivo}</p>
            <p className="mt-2 underline">
              {t("Descadastrar")} · {t("Preferências de e-mail")} · {t("Política de privacidade")}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            {t(
              "O link de descadastro e o de preferências entram sozinhos e não saem. Rodapé sem razão social, CNPJ, endereço, motivo ou privacidade trava o envio.",
            )}
          </p>
        </Secao>
      </div>

      {pode ? (
        <div className="flex justify-end">
          <Button onClick={salvar} disabled={gravar.isPending}>
            {gravar.isPending ? t("Salvando…") : t("Salvar configuração")}
          </Button>
        </div>
      ) : null}

      <Aquecimento r={r} />
      <Supressao />
      <div className="grid gap-4 lg:grid-cols-2">
        <TextosDeConsentimento r={r} pode={pode} />
        <ImportarAceites />
      </div>
    </div>
  );
}

function Dominio({ r, pode }: { r: Retrato; pode: boolean }) {
  const t = useT();
  const idioma = useTagDeIdioma();
  const verificar = useVerificarDominio();
  const [dominio, setDominio] = useState(r.dominio?.dominio ?? "");
  const [sub, setSub] = useState(r.dominio?.subdominio_de_retorno ?? "envio");
  const d = r.dominio;
  const conferir = () =>
    verificar.mutate(
      { dominio: dominio.trim() || undefined, subdominio_de_retorno: sub.trim() || undefined },
      {
        onSuccess: (res) =>
          toast[res.verificado ? "success" : "message"](
            res.verificado
              ? t(
                  "Domínio verificado. O aquecimento começa no primeiro envio, com até 200 e-mails.",
                )
              : t("Conferido. Ainda faltam registros no DNS."),
          ),
      },
    );
  async function copiar(texto: string) {
    const okCopiado = await copyToClipboard(texto);
    if (okCopiado) toast.success(t("Copiado."));
    else toast.error(t("Não deu para copiar. Selecione o texto e copie."));
  }
  const faltaSoDmarc =
    d && !d.verificado && d.faltam.length === 1 && d.faltam[0] === "dmarc" && !!d.conferido_em;
  return (
    <Secao titulo={t("Domínio do remetente")}>
      <div className="grid gap-3 sm:grid-cols-[1fr,auto,auto] sm:items-end">
        <div className="space-y-1">
          <Label htmlFor="em-dominio">{t("Domínio da empresa")}</Label>
          <Input
            id="em-dominio"
            value={dominio}
            onChange={(e) => setDominio(e.target.value)}
            disabled={!pode}
            placeholder="exemplo.com.br"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="em-sub">{t("Subdomínio de retorno")}</Label>
          <Input
            id="em-sub"
            value={sub}
            onChange={(e) => setSub(e.target.value)}
            disabled={!pode}
            className="sm:w-32"
          />
        </div>
        <Button onClick={conferir} disabled={!pode || verificar.isPending || !r.amazon.configurado}>
          {verificar.isPending ? t("Conferindo…") : d ? t("Conferir agora") : t("Criar e conferir")}
        </Button>
      </div>
      {d ? (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <b className="font-mono">{d.dominio}</b>
            {d.verificado ? (
              <Badge variant="success">{t("Verificado: pode enviar")}</Badge>
            ) : (
              <Badge variant="warning">
                {t("Faltam {n} de 6 registros: o envio fica travado").replace(
                  "{n}",
                  String(d.faltam.length),
                )}
              </Badge>
            )}
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              onClick={() =>
                void copiar(
                  d.registros.map((g) => `${g.tipo}\t${g.nomeCurto}\t${g.valor}`).join("\n"),
                )
              }
            >
              {t("Copiar os seis registros")}
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3">{t("Tipo")}</th>
                  <th className="py-2 pr-3">{t("Nome")}</th>
                  <th className="py-2 pr-3">{t("Valor")}</th>
                  <th className="py-2 pr-3">{t("Para que serve")}</th>
                  <th className="py-2">{t("Situação")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {d.registros.map((g) => (
                  <tr key={g.id}>
                    <td className="py-2 pr-3 font-semibold">{g.tipo}</td>
                    <td className="py-2 pr-3 font-mono text-xs break-all">{g.nomeCurto}</td>
                    <td className="py-2 pr-3 font-mono text-xs break-all">
                      {g.valor}{" "}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void copiar(g.valor)}
                        aria-label={t("Copiar o valor")}
                      >
                        {t("Copiar")}
                      </Button>
                    </td>
                    <td className="py-2 pr-3">{t(g.para)}</td>
                    <td className="py-2">
                      {g.ok ? (
                        <Badge variant="success">{t("Verificado")}</Badge>
                      ) : (
                        <Badge variant="warning">{t("Aguardando DNS")}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {faltaSoDmarc ? (
            <p className="rounded-md bg-warning-bg p-3 text-sm text-warning-fg">
              {t(
                "O DMARC ainda não apareceu. O erro mais comum é digitar o nome inteiro no painel do DNS, que já acrescenta o domínio. No campo nome, vai só _dmarc.",
              )}
            </p>
          ) : null}
          {d.conferido_em ? (
            <p className="text-xs text-muted-foreground">
              {t("Conferido em")} {new Date(d.conferido_em).toLocaleString(idioma)}
            </p>
          ) : null}
        </>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {t(
          "Os registros vão no DNS de quem cuida do domínio (Registro.br, Cloudflare, GoDaddy). A Amazon confere sozinha de hora em hora; o botão confere na hora. Endereço de provedor gratuito não serve de remetente.",
        )}
      </p>
    </Secao>
  );
}

function Remetentes({
  r,
  pode,
  responderPara,
  aoMudarResponder,
}: {
  r: Retrato;
  pode: boolean;
  responderPara: string;
  aoMudarResponder: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const t = useT();
  const gravar = useGravarRemetente();
  const arquivar = useArquivarRemetente();
  const [nome, setNome] = useState(r.empresa.nome);
  const [local, setLocal] = useState("");
  const dominio = r.dominio?.dominio ?? "seu-dominio";
  return (
    <Secao titulo={t('Remetente e "responder para"')}>
      <ul className="divide-y divide-border">
        {r.remetentes.length === 0 ? (
          <li className="py-2 text-sm text-muted-foreground">{t("Nenhum remetente ainda.")}</li>
        ) : null}
        {r.remetentes.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
            <div className="min-w-0">
              <b>{m.nome}</b>
              <span className="block font-mono text-xs text-muted-foreground">
                {m.local}@{dominio}
              </span>
            </div>
            <div className="ml-auto flex gap-2">
              {m.padrao ? (
                <Badge>{t("Padrão")}</Badge>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!pode}
                  onClick={() => gravar.mutate({ nome: m.nome, local: m.local, padrao: true })}
                >
                  {t("Tornar padrão")}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={!pode}
                onClick={() => arquivar.mutate({ id: m.id })}
              >
                {t("Arquivar")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {pode ? (
        <div className="grid gap-2 sm:grid-cols-[1fr,1fr,auto] sm:items-end">
          <div className="space-y-1">
            <Label htmlFor="em-rem-nome">{t("Nome de exibição")}</Label>
            <Input id="em-rem-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="em-rem-local">{t("Endereço")}</Label>
            <div className="flex items-center gap-1">
              <Input
                id="em-rem-local"
                value={local}
                onChange={(e) => setLocal(e.target.value.toLowerCase())}
                placeholder="novidades"
              />
              <span className="text-xs text-muted-foreground">@{dominio}</span>
            </div>
          </div>
          <Button
            variant="outline"
            disabled={!local.trim() || !nome.trim() || gravar.isPending}
            onClick={() =>
              gravar.mutate(
                { nome: nome.trim(), local: local.trim() },
                {
                  onSuccess: () => {
                    setLocal("");
                    toast.success(t("Remetente salvo. Ele usa o mesmo domínio verificado."));
                  },
                },
              )
            }
          >
            {t("Acrescentar remetente")}
          </Button>
        </div>
      ) : null}
      <div className="space-y-1">
        <Label htmlFor="em-responder">{t("Responder para")}</Label>
        <Input
          id="em-responder"
          value={responderPara}
          onChange={aoMudarResponder}
          disabled={!pode}
          placeholder="atendimento@exemplo.com.br"
        />
        <p className="text-xs text-muted-foreground">
          {t(
            'Começa com o "responder para" da marca da empresa (Configurações › Sua empresa › Marca).',
          )}
        </p>
      </div>
    </Secao>
  );
}

function Aquecimento({ r }: { r: Retrato }) {
  const t = useT();
  const idioma = useTagDeIdioma();
  const a = r.aquecimento;
  return (
    <Secao titulo={t("Aquecimento do domínio")}>
      <p className="text-sm">
        {a.concluido
          ? t("Aquecimento concluído: vale a cota da conta na Amazon.")
          : a.degrau === 0
            ? t("Domínio novo. O primeiro dia de envio pode até 200 e-mails.")
            : t("{n} dias de envio feitos. O próximo dia pode até {m} e-mails.")
                .replace("{n}", String(a.degrau))
                .replace("{m}", a.teto_do_proximo_dia.toLocaleString(idioma))}
      </p>
      <ol
        className="grid grid-cols-7 gap-1 sm:grid-cols-14"
        aria-label={t("Os 14 degraus do aquecimento")}
      >
        {a.degraus.map((teto, i) => (
          <li
            key={i}
            className={`rounded-md border p-1 text-center text-xs ${i < a.degrau ? "border-success bg-success-bg text-success-fg" : i === a.degrau ? "border-accent bg-accent-soft text-accent" : "border-border"}`}
          >
            <span className="block text-[10px] text-muted-foreground">
              {t("dia")} {i + 1}
            </span>
            <b>{teto.toLocaleString(idioma)}</b>
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted-foreground">
        {t(
          "Conta só dia com envio. O degrau só sobe se o dia anterior teve rejeição abaixo de 2% e reclamação abaixo de 0,1%; se passar, o degrau se repete. Depois do 14º dia, vale a cota da conta.",
        )}
      </p>
    </Secao>
  );
}

const MOTIVOS_DA_SUPRESSAO = [
  "descadastro",
  "rejeicao",
  "reclamacao",
  "manual",
  "importada",
] as const;

function Supressao() {
  const t = useT();
  const idioma = useTagDeIdioma();
  const [motivo, setMotivo] = useState("");
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const lista = useSupressao({ motivo, busca: buscaAplicada });
  const acrescentar = useAcrescentarSupressao();
  const importar = useImportarSupressao();
  const [novo, setNovo] = useState({ email: "", motivo: "Pedido por telefone" });
  const [texto, setTexto] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setBuscaAplicada(busca), 400);
    return () => clearTimeout(id);
  }, [busca]);
  const dados = lista.data;
  return (
    <Secao titulo={t("Lista de supressão")}>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("Motivo")}>
        <Button
          size="sm"
          variant={motivo === "" ? "default" : "outline"}
          onClick={() => setMotivo("")}
        >
          {t("Todos")} · {(dados?.total ?? 0).toLocaleString(idioma)}
        </Button>
        {MOTIVOS_DA_SUPRESSAO.map((m) => (
          <Button
            key={m}
            size="sm"
            variant={motivo === m ? "default" : "outline"}
            onClick={() => setMotivo(m)}
          >
            {t(ROTULO_DA_SUPRESSAO[m])} · {(dados?.porMotivo?.[m] ?? 0).toLocaleString(idioma)}
          </Button>
        ))}
      </div>
      <Input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder={t("Buscar pelo endereço")}
        aria-label={t("Buscar pelo endereço")}
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="py-2 pr-3">{t("Endereço")}</th>
              <th className="py-2 pr-3">{t("Motivo")}</th>
              <th className="py-2 pr-3">{t("De onde veio")}</th>
              <th className="py-2">{t("Quando")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(dados?.linhas ?? []).length === 0 ? (
              <tr>
                <td colSpan={4} className="py-3 text-muted-foreground">
                  {t("Nenhum endereço com esse filtro.")}
                </td>
              </tr>
            ) : null}
            {(dados?.linhas ?? []).map((l) => (
              <tr key={l.id}>
                <td className="py-2 pr-3 font-mono text-xs">{l.endereco ?? "•••"}</td>
                <td className="py-2 pr-3">
                  <Badge
                    variant={
                      l.motivo === "reclamacao" || l.motivo === "descadastro"
                        ? "error"
                        : l.motivo === "rejeicao"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {t(
                      ROTULO_DA_SUPRESSAO[l.motivo as keyof typeof ROTULO_DA_SUPRESSAO] ??
                        "Pedido à equipe",
                    )}
                  </Badge>
                </td>
                <td className="py-2 pr-3">{l.deOnde ?? ""}</td>
                <td className="py-2 whitespace-nowrap">
                  {new Date(l.quando).toLocaleDateString(idioma)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2 rounded-md border border-border p-3">
          <p className="text-sm font-medium">{t("Acrescentar à mão")}</p>
          <Input
            value={novo.email}
            onChange={(e) => setNovo((n) => ({ ...n, email: e.target.value }))}
            placeholder="nome@example.com"
            aria-label={t("E-mail")}
          />
          <select
            className={`h-9 w-full rounded-md border border-border bg-surface px-2 text-sm ${TOQUE}`}
            value={novo.motivo}
            onChange={(e) => setNovo((n) => ({ ...n, motivo: e.target.value }))}
            aria-label={t("Motivo")}
          >
            <option value="Pedido por telefone">{t("Pedido por telefone")}</option>
            <option value="Pedido por WhatsApp">{t("Pedido por WhatsApp")}</option>
            <option value="Saiu da empresa cliente">{t("A pessoa saiu da empresa cliente")}</option>
          </select>
          <Button
            size="sm"
            disabled={acrescentar.isPending || !novo.email.trim()}
            onClick={() =>
              acrescentar.mutate(novo, {
                onSuccess: (res) => {
                  toast.success(
                    res.entrou
                      ? t("Endereço acrescentado à supressão.")
                      : t("Esse endereço já está na lista."),
                  );
                  setNovo((n) => ({ ...n, email: "" }));
                },
              })
            }
          >
            {t("Acrescentar")}
          </Button>
        </div>
        <div className="space-y-2 rounded-md border border-border p-3">
          <p className="text-sm font-medium">{t("Importar da ferramenta anterior")}</p>
          <Textarea
            rows={3}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={t("Um endereço por linha")}
            aria-label={t("Um endereço por linha")}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={importar.isPending || !texto.trim()}
            onClick={() =>
              importar.mutate(
                {
                  enderecos: texto
                    .split(/[\n,;]+/)
                    .map((x) => x.trim())
                    .filter(Boolean),
                },
                {
                  onSuccess: (res) => {
                    toast.success(
                      t("{a} acrescentados, {b} já estavam, {c} recusados.")
                        .replace("{a}", String(res.acrescentadas))
                        .replace("{b}", String(res.ja_estavam))
                        .replace("{c}", String(res.recusadas.length)),
                    );
                    setTexto("");
                  },
                },
              )
            }
          >
            {t("Importar")}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {t(
          "Quem está aqui não recebe e-mail de marketing de novo, em nenhuma campanha. Ninguém tira um endereço daqui pela tela: só a própria pessoa, pelo link do e-mail. Anonimizar o contato apaga o endereço legível e mantém o veto.",
        )}
      </p>
    </Secao>
  );
}

function TextosDeConsentimento({ r, pode }: { r: Retrato; pode: boolean }) {
  const t = useT();
  const gravar = useGravarTexto();
  const [nova, setNova] = useState({ versao: "", texto: "", inclui_aviso_de_medicao: true });
  return (
    <Secao titulo={t("Textos de consentimento")}>
      <ul className="space-y-2">
        {r.textos_de_consentimento.map((v) => (
          <li key={v.versao} className="rounded-md border border-border p-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <b className="font-mono">{v.versao}</b>
              {v.incluiAvisoDeMedicao ? (
                <Badge variant="info">{t("Com aviso de medição")}</Badge>
              ) : (
                <Badge variant="neutral">{t("Sem aviso de medição")}</Badge>
              )}
              {v.rascunhoJuridico ? (
                <Badge variant="warning">{t("Rascunho para revisão jurídica")}</Badge>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {v.texto.replaceAll("{empresa}", r.empresa.nome)}
            </p>
          </li>
        ))}
      </ul>
      {pode ? (
        <div className="space-y-2 rounded-md border border-border p-3">
          <p className="text-sm font-medium">{t("Nova versão do texto")}</p>
          <Input
            value={nova.versao}
            onChange={(e) => setNova((n) => ({ ...n, versao: e.target.value }))}
            placeholder="v2"
            aria-label={t("Versão")}
          />
          <Textarea
            rows={3}
            value={nova.texto}
            onChange={(e) => setNova((n) => ({ ...n, texto: e.target.value }))}
            aria-label={t("Texto aceito")}
          />
          <label className={`flex items-center gap-3 text-sm ${TOQUE}`}>
            <Switch
              checked={nova.inclui_aviso_de_medicao}
              onCheckedChange={(v) => setNova((n) => ({ ...n, inclui_aviso_de_medicao: v }))}
            />
            {t("O texto avisa que aberturas e cliques são medidos")}
          </label>
          <Button
            size="sm"
            disabled={gravar.isPending || !nova.versao.trim() || nova.texto.trim().length < 10}
            onClick={() =>
              gravar.mutate(nova, {
                onSuccess: () => {
                  setNova({ versao: "", texto: "", inclui_aviso_de_medicao: true });
                  toast.success(t("Versão salva."));
                },
              })
            }
          >
            {t("Salvar versão")}
          </Button>
          <p className="text-xs text-muted-foreground">
            {t(
              "Versão não se edita: o aceite antigo continua apontando para o texto que a pessoa leu.",
            )}
          </p>
        </div>
      ) : null}
    </Secao>
  );
}

/** Lê "email;data;origem;versao" por linha (vírgula ou ponto e vírgula). */
function lerLinhasDeAceite(texto: string) {
  return texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^e-?mail[;,]/i.test(l))
    .map((l) => {
      const [email, data, origem, versao] = l
        .split(/[;\t]|,(?=[^,]*$)|,/)
        .map((x) => x?.trim() ?? "");
      return {
        email: email ?? "",
        data: data || null,
        origem: origem || null,
        versao: versao || null,
      };
    });
}

function ImportarAceites() {
  const t = useT();
  const importar = useImportarAceites();
  const [texto, setTexto] = useState("");
  const linhas = useMemo(() => lerLinhasDeAceite(texto), [texto]);
  const [resultado, setResultado] = useState<string | null>(null);
  return (
    <Secao titulo={t("Importar aceites")}>
      <p className="text-xs text-muted-foreground">
        {t(
          "Uma linha por aceite: e-mail; data do aceite; origem; versão do texto (opcional). Linha sem data ou sem origem é recusada: lista comprada não entra como consentimento.",
        )}
      </p>
      <Textarea
        rows={5}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder={t("ana@example.com;2026-08-12;Formulário do site;padrao-v1")}
        aria-label={t("Aceites")}
      />
      <Button
        size="sm"
        disabled={importar.isPending || linhas.length === 0}
        onClick={() =>
          importar.mutate(
            { linhas },
            {
              onSuccess: (r) =>
                setResultado(
                  t(
                    "{a} lidas, {b} gravadas, {c} já estavam, {d} já tinham saído da lista, {e} recusadas.",
                  )
                    .replace("{a}", String(r.lidas))
                    .replace("{b}", String(r.gravadas))
                    .replace("{c}", String(r.ja_estavam))
                    .replace("{d}", String(r.ja_descadastrados))
                    .replace("{e}", String(r.recusadas.length)),
                ),
            },
          )
        }
      >
        {t("Importar {n} linhas").replace("{n}", String(linhas.length))}
      </Button>
      {resultado ? <p className="text-sm">{resultado}</p> : null}
    </Secao>
  );
}
