"use client";

/**
 * FORK MIA (.89) — a tela MENSAGEM de uma campanha de e-mail (protótipo, tela 3).
 *
 * O e-mail em blocos (título, texto, imagem, botão, divisor), os campos do CRM
 * com o texto reserva, a prévia no computador e no celular, a conferência antes
 * de enviar e o TESTE obrigatório da versão atual (até 5 endereços, [TESTE] no
 * assunto, sem cobrar). A prévia é montada no navegador pelo MESMO montador do
 * envio (`montarEmail`, `lib/email-marketing/blocos.ts`): o que se vê é o que sai.
 */
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import {
  useConferencia,
  useEditarCampanha,
  useEnviarTeste,
  type CampanhaNaTela,
  type Retrato,
  type TesteNaTela,
} from "@/hooks/useEmailMarketing";
import {
  FRASES_DA_CONFERENCIA,
  montarEmail,
  ROTULO_DO_BLOCO,
  variaveisSemReserva,
  type BlocoDoEmail,
  type FraseDaConferencia,
} from "@/lib/email-marketing/blocos";
import {
  ASSUNTO_RECOMENDADO,
  MAXIMO_DE_ENDERECOS_NO_TESTE,
  PRE_CABECALHO_RECOMENDADO,
} from "@/lib/email-marketing/regras";
import {
  VARIAVEIS_DO_EMAIL,
  variaveisUsadas,
  type ValoresDoContato,
} from "@/lib/email-marketing/variaveis";
import { CaretDown, CaretUp, X } from "@/lib/ui/icons";

const TOQUE = "min-h-11 lg:min-h-0";

/** Os contatos fictícios da prévia ("ver como"). Nenhum dado de gente real. */
const VER_COMO: Record<"exemplo" | "semNome", ValoresDoContato> = {
  exemplo: {
    nome: "Ana Exemplo",
    empresa: "Empresa Exemplo",
    responsavel: "Equipe",
    campos: { cidade: "Belo Horizonte" },
  },
  semNome: { nome: null, empresa: null, responsavel: null, campos: null },
};
const ROTULO_DO_VER_COMO = {
  exemplo: "Contato de exemplo",
  semNome: "Contato sem nome cadastrado",
} as const;

function novoId(): string {
  return `b${Math.random().toString(36).slice(2, 10)}`;
}

function blocoNovo(tipo: BlocoDoEmail["tipo"]): BlocoDoEmail {
  const id = novoId();
  if (tipo === "titulo") return { id, tipo, texto: "Novo título" };
  if (tipo === "texto") return { id, tipo, texto: "Escreva aqui." };
  if (tipo === "botao") return { id, tipo, texto: "Saiba mais", url: "https://" };
  if (tipo === "imagem") return { id, tipo, url: "", alt: "" };
  return { id, tipo: "divisor" };
}

export function frase(
  t: (s: string) => string,
  chave: string | null,
  valores: { n?: number; lista?: string },
): string {
  if (!chave || !(chave in FRASES_DA_CONFERENCIA)) return chave ?? "";
  return t(FRASES_DA_CONFERENCIA[chave as FraseDaConferencia])
    .replace("{n}", String(valores.n ?? ""))
    .replace("{lista}", valores.lista ?? "");
}

export function AbaMensagem({
  campanha,
  retrato,
  testes,
}: {
  campanha: CampanhaNaTela;
  retrato: Retrato;
  testes: TesteNaTela[];
}) {
  const t = useT();
  const idioma = useTagDeIdioma();
  const rascunho = campanha.status === "rascunho";
  const editar = useEditarCampanha(campanha.id);
  const teste = useEnviarTeste(campanha.id);
  const conferencia = useConferencia(campanha.id, { quando: "agora" });
  const [rascunhoLocal, setRascunhoLocal] = useState({
    remetente_id:
      campanha.remetente_id ??
      retrato.remetentes.find((r) => r.padrao)?.id ??
      retrato.remetentes[0]?.id ??
      null,
    assunto: campanha.assunto,
    pre_cabecalho: campanha.pre_cabecalho,
    blocos: campanha.blocos,
    reservas: campanha.reservas,
  });
  const [dispositivo, setDispositivo] = useState<"pc" | "cel">("pc");
  const [verComo, setVerComo] = useState<keyof typeof VER_COMO>("exemplo");
  const [enderecos, setEnderecos] = useState("");
  const alvo = useRef<{ id: string; inicio: number; fim: number } | null>(null);
  const r = rascunhoLocal;
  const mudou =
    r.remetente_id !== campanha.remetente_id ||
    r.assunto !== campanha.assunto ||
    r.pre_cabecalho !== campanha.pre_cabecalho ||
    JSON.stringify(r.blocos) !== JSON.stringify(campanha.blocos) ||
    JSON.stringify(r.reservas) !== JSON.stringify(campanha.reservas);
  const testado = campanha.teste_versao === campanha.versao && !mudou;

  const set = (patch: Partial<typeof r>) => setRascunhoLocal((x) => ({ ...x, ...patch }));
  const setBloco = (id: string, patch: Record<string, unknown>) =>
    set({ blocos: r.blocos.map((b) => (b.id === id ? ({ ...b, ...patch } as BlocoDoEmail) : b)) });
  const mover = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= r.blocos.length) return;
    const lista = [...r.blocos];
    [lista[i], lista[j]] = [lista[j]!, lista[i]!];
    set({ blocos: lista });
  };

  function lembrarAlvo(e: React.SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const el = e.currentTarget;
    alvo.current = {
      id: el.dataset.campo ?? "",
      inicio: el.selectionStart ?? el.value.length,
      fim: el.selectionEnd ?? el.value.length,
    };
  }
  function inserirVariavel(chave: string) {
    const a = alvo.current;
    if (!a || !rascunho) {
      toast.message(t("Clique antes no campo onde a variável deve entrar."));
      return;
    }
    const token = `{{${chave}}}`;
    const enfiar = (texto: string) => texto.slice(0, a.inicio) + token + texto.slice(a.fim);
    if (a.id === "assunto") set({ assunto: enfiar(r.assunto) });
    else if (a.id === "pre") set({ pre_cabecalho: enfiar(r.pre_cabecalho) });
    else {
      const b = r.blocos.find((x) => x.id === a.id);
      if (b && "texto" in b) setBloco(b.id, { texto: enfiar(b.texto) });
    }
    alvo.current = { ...a, inicio: a.inicio + token.length, fim: a.inicio + token.length };
  }

  const salvar = (depois?: () => void) =>
    editar.mutate(
      { ...r },
      {
        onSuccess: () => {
          toast.success(t("Mensagem salva."));
          depois?.();
        },
      },
    );

  const remetente = retrato.remetentes.find((x) => x.id === r.remetente_id) ?? null;
  const dominio = retrato.dominio?.dominio ?? "seu-dominio";
  const previa = useMemo(() => {
    const v = VER_COMO[verComo];
    return montarEmail({
      campanha: {
        assunto: r.assunto,
        preCabecalho: r.pre_cabecalho,
        blocos: r.blocos,
        reservas: r.reservas,
      },
      valores: v,
      nomeDaEmpresa: retrato.empresa.nome,
      cor: { fundo: "#111827", frente: "#ffffff" },
      rodape: {
        razaoSocial: retrato.rodape.razaoSocial,
        cnpj: retrato.rodape.cnpj,
        endereco: retrato.rodape.endereco,
        motivo: retrato.rodape.motivo,
        privacidadeUrl:
          retrato.rodape.privacidadeUrl ||
          (retrato.rodape.usarPrivacidadePadrao ? "#privacidade" : null),
      },
      links: { descadastro: "#descadastro", preferencias: "#preferencias", pixel: null },
      quando: { agora: new Date(), fuso: retrato.empresa.fuso },
    });
  }, [r, verComo, retrato]);
  const usadas = variaveisUsadas(
    [
      r.assunto,
      r.pre_cabecalho,
      ...r.blocos.map((b) => ("texto" in b ? b.texto : "alt" in b ? b.alt : "")),
    ].join("\n"),
  ).filter(
    (k) =>
      VARIAVEIS_DO_EMAIL.some((v) => v.chave === k && v.precisaDeDado) || k.startsWith("contato."),
  );
  const semReserva = variaveisSemReserva({
    assunto: r.assunto,
    preCabecalho: r.pre_cabecalho,
    blocos: r.blocos,
    reservas: r.reservas,
  });

  async function subirImagem(blocoId: string, arquivo: File) {
    const corpo = new FormData();
    corpo.append("file", arquivo);
    const resp = await fetch("/api/v1/email-marketing/imagens", { method: "POST", body: corpo });
    const json = (await resp.json()) as { data?: { url?: string }; error?: { message?: string } };
    if (!resp.ok || !json.data?.url) {
      toast.error(json.error?.message ?? t("Não consegui enviar a imagem."));
      return;
    }
    setBloco(blocoId, { url: json.data.url });
    toast.success(t("Imagem enviada."));
  }

  function mandarTeste() {
    const lista = enderecos
      .split(/[\s,;]+/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (lista.length === 0) {
      toast.message(t("Escreva pelo menos um endereço."));
      return;
    }
    if (lista.length > MAXIMO_DE_ENDERECOS_NO_TESTE) {
      toast.message(t("O teste vai para no máximo 5 endereços."));
      return;
    }
    const enviar = () =>
      teste.mutate(
        { para: lista },
        {
          onSuccess: (res) =>
            res.enviados.length > 0
              ? toast.success(
                  t(
                    "Teste enviado para {n} endereço(s), com [TESTE] no assunto. Não cobrou crédito.",
                  ).replace("{n}", String(res.enviados.length)),
                )
              : toast.error(t("O teste não saiu para nenhum endereço.")),
        },
      );
    if (mudou) salvar(enviar);
    else enviar();
  }

  const travado = !rascunho;
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr,460px]">
      <div className="space-y-4">
        {travado ? (
          <p className="rounded-md bg-info-bg p-3 text-sm text-info-fg">
            {campanha.status === "agendada"
              ? t(
                  "Esta campanha já está agendada e o conteúdo fica congelado. Para mudar, cancele o agendamento.",
                )
              : t("Esta campanha já saiu: o que foi enviado não muda.")}
          </p>
        ) : null}
        <Card className="space-y-3 p-4">
          <h2 className="text-base font-semibold">{t("Cabeçalho do e-mail")}</h2>
          <div className="space-y-1">
            <Label htmlFor="cr-rem">{t("De")}</Label>
            <select
              id="cr-rem"
              className={`h-9 w-full rounded-md border border-border bg-surface px-2 text-sm ${TOQUE}`}
              value={r.remetente_id ?? ""}
              onChange={(e) => set({ remetente_id: e.target.value || null })}
              disabled={travado}
            >
              {retrato.remetentes.length === 0 ? (
                <option value="">{t("Cadastre um remetente na configuração")}</option>
              ) : null}
              {retrato.remetentes.map((m) => (
                <option key={m.id} value={m.id}>
                  {`${m.nome} <${m.local}@${dominio}>`}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              {t("Responder para:")} {retrato.responder_para ?? t("o próprio remetente")}
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cr-assunto">{t("Assunto")}</Label>
            <Input
              id="cr-assunto"
              data-campo="assunto"
              value={r.assunto}
              onChange={(e) => set({ assunto: e.target.value })}
              onSelect={lembrarAlvo}
              onFocus={lembrarAlvo}
              disabled={travado}
            />
            <p
              className={`text-xs ${r.assunto.length > ASSUNTO_RECOMENDADO ? "text-warning-fg" : "text-muted-foreground"}`}
            >
              {t("{n} de 60 caracteres").replace("{n}", String(r.assunto.length))}
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cr-pre">
              {t("Pré-cabeçalho, o texto que aparece depois do assunto na caixa de entrada")}
            </Label>
            <Input
              id="cr-pre"
              data-campo="pre"
              value={r.pre_cabecalho}
              onChange={(e) => set({ pre_cabecalho: e.target.value })}
              onSelect={lembrarAlvo}
              onFocus={lembrarAlvo}
              disabled={travado}
            />
            <p
              className={`text-xs ${r.pre_cabecalho.length > PRE_CABECALHO_RECOMENDADO ? "text-warning-fg" : "text-muted-foreground"}`}
            >
              {t("{n} de 90 caracteres").replace("{n}", String(r.pre_cabecalho.length))}
            </p>
          </div>
        </Card>

        <Card className="space-y-3 p-4">
          <h2 className="text-base font-semibold">{t("Campos do CRM")}</h2>
          <div className="flex flex-wrap gap-2">
            {VARIAVEIS_DO_EMAIL.map((v) => (
              <Button
                key={v.chave}
                size="sm"
                variant="outline"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => inserirVariavel(v.chave)}
                disabled={travado}
                title={t(v.rotulo)}
              >
                {`{{${v.chave}}}`}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {t(
              "Clique no campo de texto e depois na variável. É o mesmo vocabulário do Inbox e das Campanhas.",
            )}
          </p>
          {usadas.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("Texto reserva quando faltar o dado")}</p>
              {usadas.map((k) => (
                <div key={k} className="flex items-center gap-2">
                  <code className="w-40 shrink-0 text-xs">{`{{${k}}}`}</code>
                  <Input
                    value={r.reservas[k] ?? ""}
                    onChange={(e) => set({ reservas: { ...r.reservas, [k]: e.target.value } })}
                    placeholder={t("vazio: quem não tem o dado fica de fora")}
                    aria-label={`${t("Texto reserva")} ${k}`}
                    disabled={travado}
                  />
                </div>
              ))}
            </div>
          ) : null}
        </Card>

        <Card className="space-y-3 p-4">
          <h2 className="text-base font-semibold">{t("Corpo em blocos")}</h2>
          <div className="space-y-3">
            {r.blocos.map((b, i) => (
              <div
                key={b.id}
                className="space-y-2 rounded-md border border-border p-3"
                data-bloco={b.tipo}
              >
                <div className="flex items-center gap-1">
                  <b className="text-sm">{t(ROTULO_DO_BLOCO[b.tipo])}</b>
                  <span className="ml-auto" />
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t("Subir")}
                    onClick={() => mover(i, -1)}
                    disabled={travado || i === 0}
                  >
                    <CaretUp size={16} />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t("Descer")}
                    onClick={() => mover(i, 1)}
                    disabled={travado || i === r.blocos.length - 1}
                  >
                    <CaretDown size={16} />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t("Tirar o bloco")}
                    onClick={() => set({ blocos: r.blocos.filter((x) => x.id !== b.id) })}
                    disabled={travado}
                  >
                    <X size={16} />
                  </Button>
                </div>
                {b.tipo === "titulo" ? (
                  <Input
                    data-campo={b.id}
                    value={b.texto}
                    onChange={(e) => setBloco(b.id, { texto: e.target.value })}
                    onSelect={lembrarAlvo}
                    onFocus={lembrarAlvo}
                    aria-label={t("Texto do título")}
                    disabled={travado}
                  />
                ) : b.tipo === "texto" ? (
                  <Textarea
                    data-campo={b.id}
                    rows={4}
                    value={b.texto}
                    onChange={(e) => setBloco(b.id, { texto: e.target.value })}
                    onSelect={lembrarAlvo}
                    onFocus={lembrarAlvo}
                    aria-label={t("Texto")}
                    disabled={travado}
                  />
                ) : b.tipo === "botao" ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input
                      value={b.texto}
                      onChange={(e) => setBloco(b.id, { texto: e.target.value })}
                      aria-label={t("Texto do botão")}
                      disabled={travado}
                    />
                    <Input
                      value={b.url}
                      onChange={(e) => setBloco(b.id, { url: e.target.value })}
                      aria-label={t("Endereço do botão")}
                      disabled={travado}
                    />
                  </div>
                ) : b.tipo === "imagem" ? (
                  <div className="space-y-2">
                    {b.url ? (
                      <p className="truncate text-xs text-muted-foreground">{b.url}</p>
                    ) : null}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/gif"
                      disabled={travado}
                      aria-label={t("Escolher a imagem")}
                      className={`block w-full text-xs ${TOQUE}`}
                      onChange={(e) => {
                        const arquivo = e.target.files?.[0];
                        if (arquivo) void subirImagem(b.id, arquivo);
                        e.target.value = "";
                      }}
                    />
                    <Input
                      value={b.alt}
                      onChange={(e) => setBloco(b.id, { alt: e.target.value })}
                      placeholder={t("Texto alternativo: o que a imagem mostra")}
                      aria-label={t("Texto alternativo da imagem")}
                      disabled={travado}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("PNG, JPEG ou GIF, até 1 MB.")}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t("Uma linha fina separando as partes.")}
                  </p>
                )}
              </div>
            ))}
          </div>
          {!travado ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">{t("Acrescentar")}</span>
              {(Object.keys(ROTULO_DO_BLOCO) as BlocoDoEmail["tipo"][]).map((tipo) => (
                <Button
                  key={tipo}
                  size="sm"
                  variant="outline"
                  onClick={() => set({ blocos: [...r.blocos, blocoNovo(tipo)] })}
                >
                  + {t(ROTULO_DO_BLOCO[tipo])}
                </Button>
              ))}
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {t(
              "O rodapé vem da configuração: razão social, CNPJ, endereço, por que a pessoa recebe, e os links de descadastro e preferências, que não saem.",
            )}
          </p>
        </Card>
        {!travado ? (
          <div className="flex justify-end">
            <Button onClick={() => salvar()} disabled={!mudou || editar.isPending}>
              {editar.isPending
                ? t("Salvando…")
                : mudou
                  ? t("Salvar a mensagem")
                  : t("Mensagem salva")}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">{t("Prévia")}</h2>
            <div className="ml-auto flex gap-1" role="group" aria-label={t("Aparelho")}>
              <Button
                size="sm"
                variant={dispositivo === "pc" ? "default" : "outline"}
                onClick={() => setDispositivo("pc")}
              >
                {t("Computador")}
              </Button>
              <Button
                size="sm"
                variant={dispositivo === "cel" ? "default" : "outline"}
                onClick={() => setDispositivo("cel")}
              >
                {t("Celular")}
              </Button>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cr-vercomo">{t("Ver como")}</Label>
            <select
              id="cr-vercomo"
              className={`h-9 w-full rounded-md border border-border bg-surface px-2 text-sm ${TOQUE}`}
              value={verComo}
              onChange={(e) => setVerComo(e.target.value as keyof typeof VER_COMO)}
            >
              {(Object.keys(VER_COMO) as Array<keyof typeof VER_COMO>).map((k) => (
                <option key={k} value={k}>
                  {t(ROTULO_DO_VER_COMO[k])}
                </option>
              ))}
            </select>
          </div>
          <div className="rounded-md border border-border p-2 text-sm">
            <b>{remetente?.nome ?? retrato.empresa.nome}</b>
            <p className="truncate text-xs text-muted-foreground">
              <b>{previa.assunto || t("(sem assunto)")}</b> · {r.pre_cabecalho}
            </p>
          </div>
          <div
            className={`mx-auto overflow-hidden rounded-md border border-border bg-white ${dispositivo === "cel" ? "w-[360px] max-w-full" : "w-full"}`}
          >
            <iframe
              title={t("Prévia do e-mail")}
              sandbox=""
              srcDoc={previa.html}
              className="h-[520px] w-full"
            />
          </div>
          {semReserva.length > 0 ? (
            <p className="text-xs text-warning-fg">
              {t("Sem texto reserva para {lista}: quem não tem o dado fica de fora.").replace(
                "{lista}",
                semReserva.map((k) => `{{${k}}}`).join(", "),
              )}
            </p>
          ) : null}
        </Card>

        <Card className="space-y-2 p-4">
          <h2 className="text-base font-semibold">{t("Antes de enviar")}</h2>
          {mudou ? (
            <p className="text-xs text-muted-foreground">
              {t("Salve a mensagem para a conferência ler a versão nova.")}
            </p>
          ) : null}
          <ul className="space-y-1">
            {(conferencia.data?.conteudo ?? []).map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <Badge
                  variant={
                    item.nivel === "ok" ? "success" : item.nivel === "aviso" ? "warning" : "error"
                  }
                >
                  {item.nivel === "ok" ? t("ok") : item.nivel === "aviso" ? t("aviso") : t("trava")}
                </Badge>
                <span>
                  <b>{frase(t, item.titulo, item.valores)}</b>
                  {item.detalhe ? (
                    <small className="block text-xs text-muted-foreground">
                      {frase(t, item.detalhe, item.valores)}
                    </small>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="space-y-2 p-4" data-teste={testado ? "atual" : "pendente"}>
          <h2 className="text-base font-semibold">{t("Envio de teste")}</h2>
          <Label htmlFor="cr-teste">{t("Para até 5 endereços, separados por vírgula")}</Label>
          <Input
            id="cr-teste"
            value={enderecos}
            onChange={(e) => setEnderecos(e.target.value)}
            placeholder="voce@exemplo.com.br"
            disabled={travado}
          />
          <Button
            onClick={mandarTeste}
            disabled={travado || teste.isPending || !retrato.amazon.configurado}
          >
            {teste.isPending ? t("Enviando…") : t("Enviar teste")}
          </Button>
          <ul className="space-y-1 text-xs">
            {testes.map((x) => (
              <li key={x.id}>
                <b>{new Date(x.enviado_em).toLocaleString(idioma)}</b> · {x.para.join(", ")} ·{" "}
                {t("versão")} {x.versao}{" "}
                {x.versao === campanha.versao ? (
                  <Badge variant="success">{t("atual")}</Badge>
                ) : (
                  <Badge variant="neutral">{t("antiga")}</Badge>
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            {t(
              "Sai pelo mesmo caminho da campanha, com [TESTE] no assunto, e não cobra crédito. Na empresa de demonstração, nada sai de verdade.",
            )}
          </p>
        </Card>
      </div>
    </div>
  );
}
