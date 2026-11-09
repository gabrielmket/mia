"use client";

/**
 * FORK MIA (.107) · O CADASTRO DO RAIO-X GRÁTIS na página do sistema
 * (`/raio-x/gratis`; protótipo aprovado em 06/11/2026, tela 1). É o MESMO
 * formulário do site iamia.com.br: os mesmos campos, postando no mesmo endereço
 * (`POST /api/v1/publico/raio-x/cadastro`).
 *
 * Sem JavaScript, ele é um `<form>` comum: o servidor responde com 303 para a
 * página de conexão (ou de volta aqui com `?erro=`). Com JavaScript, manda por
 * `fetch` em JSON e mostra os erros sem perder o que foi digitado.
 *
 * Ajuste do dono em 06/11/2026: o cadastro ficou mais curto. Quem atende e o
 * horário SAÍRAM daqui (a rota segue aceitando, opcionais, para o site); a
 * página de conexão pergunta, opcional, enquanto o histórico chega.
 */
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { CAMPOS_DE_ORIGEM, FRASE_DO_CAMPO, PAGINA_DO_CADASTRO, validarCadastro, type CampoDoCadastro } from "@/lib/raio-x/cadastro";
import { SEGMENTOS } from "@/lib/raio-x/regras";
import { ROTULO_DO_SEGMENTO } from "@/lib/raio-x/segmentos";

const SELECT = "h-10 w-full rounded-md border border-border bg-background px-3 text-sm";

export interface InicialDoCadastro {
  email: string;
  erros: CampoDoCadastro[];
  origem: Partial<Record<(typeof CAMPOS_DE_ORIGEM)[number], string>>;
  termo: string;
}

export function CadastroGratis({ inicial }: { inicial: InicialDoCadastro }) {
  const t = useT();
  const [v, setV] = useState({
    nome: "",
    email: inicial.email,
    telefone: "",
    whatsapp: "",
    empresa: "",
    segmento: "revenda_de_veiculos",
  });
  const [aceite, setAceite] = useState(false);
  const [erros, setErros] = useState<CampoDoCadastro[]>(inicial.erros);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const set = (k: keyof typeof v, valor: string) => setV((x) => ({ ...x, [k]: valor }));
  const erro = (c: CampoDoCadastro) => (erros.includes(c) ? <p className="text-xs text-error-fg">{t(FRASE_DO_CAMPO[c])}</p> : null);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAviso(null);
    const site = (new FormData(e.currentTarget).get("site") as string | null) ?? "";
    const corpo = { ...v, aceite: aceite ? "sim" : "", site, ...inicial.origem };
    const local = validarCadastro(corpo);
    if (!local.ok) {
      setErros(local.campos);
      return;
    }
    setErros([]);
    setEnviando(true);
    try {
      const r = await fetch("/api/v1/publico/raio-x/cadastro", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const lido = ((await r.json().catch(() => ({}))) ?? {}) as {
        data?: { link?: string };
        error?: { message?: string; details?: { campos?: CampoDoCadastro[]; entrar?: string } };
      };
      if (r.status === 201 && lido.data?.link) {
        window.location.assign(lido.data.link);
        return;
      }
      if (r.status === 409 && lido.error?.details?.entrar) {
        window.location.assign(lido.error.details.entrar);
        return;
      }
      if (r.status === 400 && lido.error?.details?.campos) setErros(lido.error.details.campos);
      else setAviso(lido.error?.message ?? t("Não deu para criar o seu Raio-X agora. Tente de novo em alguns minutos."));
    } catch {
      setAviso(t("Não deu para criar o seu Raio-X agora. Tente de novo em alguns minutos."));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-5 bg-bg px-4 py-8 text-text">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{t("Raio-X do seu atendimento no WhatsApp, grátis")}</h1>
        <p className="text-sm text-text-muted">
          {t("Conecte o WhatsApp da empresa por alguns minutos e receba um relatório com o tempo da primeira resposta, quem ficou sem resposta, quem sumiu sem retorno e o que dá para ganhar. Só leitura: nenhuma mensagem sai do seu número.")}
        </p>
        {/* Ajuste do dono em 06/11/2026 (tela 1): uma linha só, no lugar dos três cartões. */}
        <p className="text-sm" data-raio-x="linha-do-gratis">
          <b>{t("A primeira análise é grátis")}</b> {t("(últimos 30 dias de conversas) e o relatório chega no seu e-mail em cerca de 1 hora.")}
        </p>
      </header>

      {/* O formulário funciona sem JavaScript: o POST é o mesmo do site. */}
      <form method="post" action="/api/v1/publico/raio-x/cadastro" onSubmit={enviar} className="space-y-5" data-raio-x="cadastro" noValidate>
        <input type="hidden" name="retorno_erro" value={PAGINA_DO_CADASTRO} />
        {CAMPOS_DE_ORIGEM.map((c) => (inicial.origem[c] ? <input key={c} type="hidden" name={c} value={inicial.origem[c]} /> : null))}
        {/* A armadilha: escondida de quem enxerga e de quem usa leitor de tela; robô preenche. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label htmlFor="raio-x-site">{t("Não preencha este campo")}</label>
          <input id="raio-x-site" name="site" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
        </div>

        <section className="space-y-4 rounded-lg border border-border bg-surface p-5">
          <h2 className="text-base font-semibold">{t("Seus dados")}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="raio-x-nome">{t("Nome completo")}</Label>
              <Input id="raio-x-nome" name="nome" autoComplete="name" value={v.nome} onChange={(e) => set("nome", e.target.value)} aria-invalid={erros.includes("nome")} />
              <p className="text-xs text-text-muted">{t("Quem autoriza a leitura. Fica registrado no aceite.")}</p>
              {erro("nome")}
            </div>
            <div className="space-y-1">
              <Label htmlFor="raio-x-email">{t("E-mail")}</Label>
              <Input id="raio-x-email" name="email" type="email" inputMode="email" autoComplete="email" value={v.email} onChange={(e) => set("email", e.target.value)} aria-invalid={erros.includes("email")} />
              <p className="text-xs text-text-muted">{t("O relatório e o código de acesso à sua área chegam aqui.")}</p>
              {erro("email")}
            </div>
            <div className="space-y-1">
              <Label htmlFor="raio-x-telefone">{t("Seu WhatsApp")}</Label>
              <Input id="raio-x-telefone" name="telefone" type="tel" autoComplete="tel" placeholder="(31) 90000-2202" value={v.telefone} onChange={(e) => set("telefone", e.target.value)} aria-invalid={erros.includes("telefone")} />
              <p className="text-xs text-text-muted">{t("Para a equipe falar com você.")}</p>
              {erro("telefone")}
            </div>
            <div className="space-y-1">
              <Label htmlFor="raio-x-whatsapp">{t("WhatsApp que vai ser analisado")}</Label>
              <Input id="raio-x-whatsapp" name="whatsapp" type="tel" placeholder="(31) 90000-1101" value={v.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} aria-invalid={erros.includes("whatsapp")} />
              <p className="text-xs text-text-muted">{t("O número que atende os clientes (pode ser o do comercial). É ele que você vai conectar. Pode ser o mesmo de cima.")}</p>
              {erro("whatsapp")}
            </div>
            <div className="space-y-1">
              <Label htmlFor="raio-x-empresa">{t("Empresa")}</Label>
              <Input id="raio-x-empresa" name="empresa" autoComplete="organization" value={v.empresa} onChange={(e) => set("empresa", e.target.value)} aria-invalid={erros.includes("empresa")} />
              {erro("empresa")}
            </div>
            <div className="space-y-1">
              <Label htmlFor="raio-x-segmento">{t("Segmento")}</Label>
              <select id="raio-x-segmento" name="segmento" className={SELECT} value={v.segmento} onChange={(e) => set("segmento", e.target.value)}>
                {SEGMENTOS.map((s) => (
                  <option key={s} value={s}>
                    {t(ROTULO_DO_SEGMENTO[s])}
                  </option>
                ))}
              </select>
              {erro("segmento")}
            </div>
          </div>
        </section>

        <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
          <h2 className="text-base font-semibold">{t("Autorização")}</h2>
          <p className="rounded-md border border-border bg-surface-elevated p-3 text-sm">
            <b>{t("O que você autoriza:")}</b>{" "}
            {t("a Time Company lê, só para este relatório, as conversas dos últimos 30 dias do número acima. Nada é enviado do seu número e ninguém da Time responde por ele. Os trechos que aparecem no relatório vão sem nome, telefone ou documento dos seus clientes. A conexão cai sozinha 7 dias depois do relatório, e as conversas lidas são apagadas em 30 dias.")}
          </p>
          <details id="termo" className="rounded-md border border-border bg-surface-elevated p-3 text-sm">
            <summary className="cursor-pointer font-medium">{t("Ler o termo inteiro")}</summary>
            <pre className="mt-3 whitespace-pre-wrap font-sans text-xs leading-relaxed" data-raio-x="termo">
              {inicial.termo}
            </pre>
          </details>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="aceite" value="sim" className="mt-1" checked={aceite} onChange={(e) => setAceite(e.target.checked)} data-raio-x="aceite" />
            <span>
              <b>{t("Li e autorizo.")}</b> {t("Fica registrado com o meu nome completo, o e-mail, a data, a hora e a versão do termo.")}
            </span>
          </label>
          {erro("aceite")}
          {erro("site")}
          {aviso ? <p className="text-sm text-error-fg">{aviso}</p> : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={enviando} data-raio-x="cadastrar">
              {enviando ? t("Criando…") : t("Criar meu Raio-X grátis")}
            </Button>
            <span className="text-xs text-text-muted">{t("Uma análise grátis por número de WhatsApp.")}</span>
          </div>
        </section>
      </form>
    </main>
  );
}
