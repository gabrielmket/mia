"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import type { DadosFiscais } from "@/lib/dados-fiscais/regras";

/** Os campos como a tela os guarda (texto cru, com máscara). */
export interface ValoresFiscais {
  tipo: "pj" | "pf";
  documento: string;
  razao_social: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  inscricao_municipal: string;
  inscricao_estadual: string;
  telefone: string;
}

export const FISCAIS_VAZIOS: ValoresFiscais = {
  tipo: "pj",
  documento: "",
  razao_social: "",
  cep: "",
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  uf: "",
  inscricao_municipal: "",
  inscricao_estadual: "",
  telefone: "",
};

type Campos = Partial<Record<keyof DadosFiscais, string>>;

/**
 * FORK MIA (.96) · "Dados da empresa para a cobrança e a nota fiscal", no
 * cadastro e no passo do pagamento (protótipo "Pagamento no início", tela 1).
 * Empresa (CNPJ) ou pessoa física (CPF); razão social ou nome completo; CEP com
 * busca; rua, número, complemento, bairro, cidade e UF; as inscrições, opcionais
 * e só na empresa. "Preencher pelo CNPJ" usa a consulta da Receita que o sistema
 * já tem. Quem confere é `lib/dados-fiscais/regras.ts`, aqui e no servidor.
 */
export function CamposFiscais({
  valores,
  aoMudar,
  erros = {},
  comTelefone = false,
  nomeFantasia,
  prefixo = "fiscal",
  documentoTravado = false,
}: {
  valores: ValoresFiscais;
  aoMudar: (proximos: ValoresFiscais) => void;
  erros?: Campos;
  /** O WhatsApp de quem assina mora junto (no passo do pagamento); no cadastro ele vem antes. */
  comTelefone?: boolean;
  /** O campo do nome fantasia é o do cadastro (o nome da empresa); aqui só para preencher pela Receita. */
  nomeFantasia?: { valor: string; aoMudar: (v: string) => void };
  prefixo?: string;
  /**
   * FORK MIA (.96, área de cobrança): o tipo e o CPF ou CNPJ só aparecem, sem
   * mudar (decisão 10: trocar o titular é pedido à Time). O servidor confere de novo.
   */
  documentoTravado?: boolean;
}) {
  const t = useT();
  const [buscando, setBuscando] = useState<"cnpj" | "cep" | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const pj = valores.tipo === "pj";
  const muda = (campo: keyof ValoresFiscais, valor: string) => aoMudar({ ...valores, [campo]: valor });
  const id = (campo: string) => `${prefixo}-${campo}`;

  async function preencherPeloCnpj() {
    setAviso(null);
    setBuscando("cnpj");
    try {
      const r = await fetch(`/api/v1/publico/cnpj?cnpj=${encodeURIComponent(valores.documento)}`, { credentials: "same-origin" });
      const corpo = (await r.json().catch(() => null)) as
        | { data?: { razao_social: string | null; nome_fantasia: string | null; endereco: Record<string, string | null> }; error?: { message?: string } }
        | null;
      if (!r.ok || !corpo?.data) {
        setAviso(corpo?.error?.message ?? t("A consulta à Receita não respondeu agora. Preencha à mão."));
        return;
      }
      const e = corpo.data.endereco;
      aoMudar({
        ...valores,
        razao_social: corpo.data.razao_social ?? valores.razao_social,
        cep: e.cep ?? valores.cep,
        logradouro: e.logradouro ?? valores.logradouro,
        numero: e.numero ?? valores.numero,
        complemento: e.complemento ?? valores.complemento,
        bairro: e.bairro ?? valores.bairro,
        cidade: e.cidade ?? valores.cidade,
        uf: e.uf ?? valores.uf,
      });
      if (nomeFantasia && !nomeFantasia.valor.trim() && corpo.data.nome_fantasia) nomeFantasia.aoMudar(corpo.data.nome_fantasia);
      setAviso(t("Razão social e endereço preenchidos pela Receita. Confira antes de seguir."));
    } finally {
      setBuscando(null);
    }
  }

  async function buscarCep() {
    setAviso(null);
    setBuscando("cep");
    try {
      const r = await fetch(`/api/v1/publico/cep?cep=${encodeURIComponent(valores.cep)}`, { credentials: "same-origin" });
      const corpo = (await r.json().catch(() => null)) as
        | { data?: { endereco: Record<string, string | null> }; error?: { message?: string } }
        | null;
      if (!r.ok || !corpo?.data) {
        setAviso(corpo?.error?.message ?? t("A busca do CEP não respondeu agora. Preencha à mão."));
        return;
      }
      const e = corpo.data.endereco;
      aoMudar({
        ...valores,
        logradouro: e.logradouro ?? valores.logradouro,
        bairro: e.bairro ?? valores.bairro,
        cidade: e.cidade ?? valores.cidade,
        uf: e.uf ?? valores.uf,
      });
    } finally {
      setBuscando(null);
    }
  }

  const erro = (campo: keyof DadosFiscais) =>
    erros[campo] ? (
      <p className="text-xs text-destructive">{t(erros[campo] === "invalido" ? "Confira este campo." : "Preencha este campo.")}</p>
    ) : null;
  const campo = (k: keyof ValoresFiscais, rotulo: string, extra: { opcional?: boolean; maxLength?: number; inputMode?: "numeric" | "tel"; autoComplete?: string } = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={id(k)}>
        {rotulo}
        {extra.opcional ? <span className="font-normal text-muted-foreground"> {t("(opcional)")}</span> : null}
      </Label>
      <Input
        id={id(k)}
        value={valores[k]}
        maxLength={extra.maxLength}
        inputMode={extra.inputMode}
        autoComplete={extra.autoComplete}
        aria-invalid={erros[k as keyof DadosFiscais] ? true : undefined}
        onChange={(ev) => muda(k, ev.target.value)}
      />
      {erro(k as keyof DadosFiscais)}
    </div>
  );

  return (
    <fieldset className="space-y-3" data-pagamento="dados-fiscais">
      <legend className="text-sm font-semibold">{t("Dados da empresa para a cobrança e a nota fiscal")}</legend>
      {documentoTravado ? (
        <div className="space-y-1.5" data-pagamento="documento-travado">
          <Label htmlFor={id("documento")}>{pj ? t("CNPJ") : t("CPF")}</Label>
          <Input id={id("documento")} value={valores.documento} readOnly disabled aria-readonly />
          <p className="text-xs text-muted-foreground">
            {t("O CNPJ ou CPF não muda por aqui: trocar o titular é pedido à Time.")}
          </p>
        </div>
      ) : (
      <>
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t("Empresa ou pessoa física")}>
        {(
          [
            ["pj", t("Empresa (CNPJ)"), t("Nota em nome da empresa")],
            ["pf", t("Pessoa física (CPF)"), t("Profissional autônomo")],
          ] as const
        ).map(([valor, rotulo, ajuda]) => (
          <button
            key={valor}
            type="button"
            role="radio"
            aria-checked={valores.tipo === valor}
            onClick={() => aoMudar({ ...valores, tipo: valor })}
            className={`rounded-md border p-3 text-left text-sm ${valores.tipo === valor ? "border-primary bg-muted/60" : "bg-background"}`}
          >
            <span className="block font-medium">{rotulo}</span>
            <span className="block text-xs text-muted-foreground">{ajuda}</span>
          </button>
        ))}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id("documento")}>{pj ? t("CNPJ") : t("CPF")}</Label>
        <div className="flex gap-2">
          <Input
            id={id("documento")}
            value={valores.documento}
            inputMode={pj ? undefined : "numeric"}
            autoComplete="off"
            placeholder={pj ? "00.000.000/0000-00" : "000.000.000-00"}
            aria-invalid={erros.documento ? true : undefined}
            onChange={(ev) => muda("documento", ev.target.value)}
          />
          {pj ? (
            <Button type="button" variant="outline" disabled={buscando !== null} onClick={() => void preencherPeloCnpj()}>
              {buscando === "cnpj" ? t("Buscando...") : t("Preencher pelo CNPJ")}
            </Button>
          ) : null}
        </div>
        {pj ? <p className="text-xs text-muted-foreground">{t("Buscamos a razão social e o endereço na Receita. Confira antes de seguir.")}</p> : null}
        {erro("documento")}
      </div>
      </>
      )}
      {campo("razao_social", pj ? t("Razão social") : t("Nome completo"), { maxLength: 120, autoComplete: pj ? "organization" : "name" })}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={id("cep")}>{t("CEP")}</Label>
          <div className="flex gap-2">
            <Input
              id={id("cep")}
              value={valores.cep}
              inputMode="numeric"
              autoComplete="postal-code"
              placeholder="00000-000"
              aria-invalid={erros.cep ? true : undefined}
              onChange={(ev) => muda("cep", ev.target.value)}
            />
            <Button type="button" variant="outline" disabled={buscando !== null} onClick={() => void buscarCep()}>
              {buscando === "cep" ? t("Buscando...") : t("Buscar")}
            </Button>
          </div>
          {erro("cep")}
        </div>
        {campo("numero", t("Número"), { maxLength: 20 })}
      </div>
      {campo("logradouro", t("Rua"), { maxLength: 120, autoComplete: "address-line1" })}
      <div className="grid gap-3 sm:grid-cols-2">
        {campo("complemento", t("Complemento"), { opcional: true, maxLength: 80, autoComplete: "address-line2" })}
        {campo("bairro", t("Bairro"), { maxLength: 80 })}
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_6rem]">
        {campo("cidade", t("Cidade"), { maxLength: 80, autoComplete: "address-level2" })}
        {campo("uf", t("UF"), { maxLength: 2, autoComplete: "address-level1" })}
      </div>
      {pj ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {campo("inscricao_municipal", t("Inscrição municipal"), { opcional: true, maxLength: 30 })}
          {campo("inscricao_estadual", t("Inscrição estadual"), { opcional: true, maxLength: 30 })}
        </div>
      ) : null}
      {comTelefone ? campo("telefone", t("WhatsApp"), { maxLength: 32, inputMode: "tel", autoComplete: "tel" }) : null}
      {aviso ? (
        <p className="text-xs text-muted-foreground" role="status">
          {aviso}
        </p>
      ) : null}
    </fieldset>
  );
}

/** Os dados como o servidor devolve (formatados) → os valores da tela. */
export function valoresDe(campos: ValoresFiscais | null | undefined): ValoresFiscais {
  return campos ? { ...FISCAIS_VAZIOS, ...campos } : { ...FISCAIS_VAZIOS };
}
