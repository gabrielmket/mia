"use client";

/**
 * FORK MIA (.79, empresa única) — cadastrar empresa (protótipo aprovado em 15/10/2026, tela 1).
 *
 * Com CNPJ, a consulta preenche razão social, situação, atividade e endereço, e
 * a pessoa revisa antes de salvar. Sem CNPJ, basta o nome. As duas regras do
 * protótipo que aparecem aqui:
 *
 *  - CNPJ que já existe: NÃO dá para cadastrar de novo, e a tela leva à empresa
 *    que existe ("Abrir a empresa"). Filial tem CNPJ próprio e entra como outra;
 *  - sem CNPJ e com nome parecido com uma que existe: AVISA e deixa escolher
 *    entre usar a existente e criar mesmo assim.
 *
 * A consulta sai para a Receita só por aqui, por uma pessoa; na empresa de
 * demonstração ela fica desligada (a rota recusa antes de sair).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { useConsultarCnpj, useSalvarEmpresa, type ConsultaDoCnpj } from "@/hooks/useEmpresas";
import { ApiError } from "@/lib/api/types";
import { formatarCnpj } from "@/lib/empresas/formato";

type Existente = { id: string; nome: string; cnpj: string | null };
type Aviso =
  | { tipo: "cnpj"; existente: Existente | null }
  | { tipo: "nome"; existente: Existente }
  | { tipo: "vazio" }
  | { tipo: "erro"; mensagem: string };

function existenteDe(e: unknown): Existente | null {
  if (!(e instanceof ApiError)) return null;
  const x = (e.details as { existente?: Existente | null } | undefined)?.existente;
  return x && typeof x.id === "string" ? x : null;
}

export function NovaEmpresa({ aoFechar }: { aoFechar: () => void }) {
  const t = useT();
  const router = useRouter();
  const consultar = useConsultarCnpj();
  const salvar = useSalvarEmpresa();
  const [cnpj, setCnpj] = useState("");
  const [nome, setNome] = useState("");
  const [razao, setRazao] = useState("");
  const [receita, setReceita] = useState<ConsultaDoCnpj | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);

  const digitos = cnpj.replace(/\D/g, "");

  const aoConsultar = () => {
    setAviso(null);
    if (digitos.length !== 14) {
      setAviso({ tipo: "erro", mensagem: t("Informe os 14 números do CNPJ.") });
      return;
    }
    consultar.mutate(cnpj, {
      onSuccess: (r) => {
        setReceita(r);
        setCnpj(r.cnpj);
        const c = r.campos as { legal_name?: string | null; trade_name?: string | null };
        if (c.legal_name) setRazao(c.legal_name);
        if (!nome.trim()) setNome(c.trade_name ?? c.legal_name ?? "");
      },
      onError: (e) => {
        setReceita(null);
        if (e instanceof ApiError && e.code === "cnpj_ja_cadastrado") setAviso({ tipo: "cnpj", existente: existenteDe(e) });
        else setAviso({ tipo: "erro", mensagem: e instanceof Error ? e.message : t("Não consegui consultar a Receita agora.") });
      },
    });
  };

  const aoSalvar = (criarMesmoAssim = false) => {
    setAviso(null);
    if (!nome.trim()) {
      setAviso({ tipo: "vazio" });
      return;
    }
    const consultadoEsteCnpj = receita && receita.normalized_cnpj === digitos;
    salvar.mutate(
      {
        dados: {
          nome: nome.trim(),
          ...(razao.trim() ? { razao_social: razao.trim() } : {}),
          ...(digitos ? { cnpj: digitos } : {}),
          ...(consultadoEsteCnpj ? { receita: receita.campos, receita_bruta: receita.bruta } : {}),
          ...(criarMesmoAssim ? { criar_mesmo_assim: true } : {}),
        },
      },
      {
        onSuccess: (r) => {
          const id = (r as { data?: { id?: string } }).data?.id;
          aoFechar();
          if (id) router.push(`/app/companies/${id}`);
        },
        onError: (e) => {
          if (e instanceof ApiError && e.code === "cnpj_ja_cadastrado") setAviso({ tipo: "cnpj", existente: existenteDe(e) });
          else if (e instanceof ApiError && e.code === "nome_parecido") {
            const existente = existenteDe(e);
            if (existente) setAviso({ tipo: "nome", existente });
            else setAviso({ tipo: "erro", mensagem: e.message });
          } else setAviso({ tipo: "erro", mensagem: e instanceof Error ? e.message : t("Não consegui salvar a empresa.") });
        },
      },
    );
  };

  const campos = (receita?.campos ?? {}) as Record<string, unknown>;
  const texto = (k: string) => (typeof campos[k] === "string" ? (campos[k] as string) : null);

  return (
    <Dialog open onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" data-testid="nova-empresa">
        <DialogHeader>
          <DialogTitle>{t("Nova empresa")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="ne-cnpj">{t("CNPJ (opcional)")}</Label>
            <div className="flex gap-2">
              <Input
                id="ne-cnpj"
                value={cnpj}
                inputMode="numeric"
                placeholder="00.000.000/0000-00"
                maxLength={20}
                onChange={(e) => {
                  setCnpj(e.target.value);
                  setAviso(null);
                }}
              />
              <Button type="button" variant="outline" disabled={consultar.isPending || !digitos} onClick={aoConsultar}>
                {consultar.isPending ? t("Consultando…") : t("Consultar CNPJ")}
              </Button>
            </div>
          </div>

          {receita ? (
            <div className="rounded-md border border-border bg-surface-muted p-3 text-xs" data-testid="veio-da-receita">
              <p className="font-medium text-text">{t("Veio da Receita")}</p>
              <p className="mt-1 text-text">
                {[texto("legal_name"), texto("registration_status"), texto("opened_at") ? `${t("aberta em")} ${texto("opened_at")}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {texto("main_cnae_description") ? <p className="text-text-muted">{texto("main_cnae_description")}</p> : null}
              {texto("city") ? (
                <p className="text-text-muted">
                  {[texto("street"), texto("number"), texto("district"), texto("city"), texto("state")].filter(Boolean).join(", ")}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-1">
            <Label htmlFor="ne-nome">{t("Nome da empresa")}</Label>
            <Input id="ne-nome" value={nome} maxLength={200} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ne-razao">{t("Razão social")}</Label>
            <Input id="ne-razao" value={razao} maxLength={500} onChange={(e) => setRazao(e.target.value)} />
          </div>

          {aviso?.tipo === "cnpj" ? (
            <div role="alert" className="rounded-md border border-error-fg bg-error-bg p-3 text-sm text-error-fg">
              {t("Este CNPJ já está cadastrado")}
              {aviso.existente ? `: ${aviso.existente.nome}` : ""}. {t("Não dá para cadastrar de novo.")}
              {aviso.existente ? (
                <div className="mt-2">
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/app/companies/${aviso.existente.id}`} onClick={aoFechar}>
                      {t("Abrir a empresa")}
                    </Link>
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
          {aviso?.tipo === "nome" ? (
            <div role="alert" className="rounded-md border border-warning-fg bg-warning-bg p-3 text-sm text-warning-fg">
              {t("Parece a mesma empresa")}: {aviso.existente.nome}
              {aviso.existente.cnpj ? ` (${formatarCnpj(aviso.existente.cnpj)})` : ""}.
              <div className="mt-2 flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <Link href={`/app/companies/${aviso.existente.id}`} onClick={aoFechar}>
                    {t("Usar a existente")}
                  </Link>
                </Button>
                <Button size="sm" variant="outline" disabled={salvar.isPending} onClick={() => aoSalvar(true)}>
                  {t("Criar mesmo assim")}
                </Button>
              </div>
            </div>
          ) : null}
          {aviso?.tipo === "vazio" ? (
            <p role="alert" className="text-sm text-error-fg">
              {t("Informe pelo menos o nome da empresa.")}
            </p>
          ) : null}
          {aviso?.tipo === "erro" ? (
            <p role="alert" className="text-sm text-error-fg">
              {aviso.mensagem}
            </p>
          ) : null}

          <p className="text-xs text-text-muted">
            {t("Com CNPJ, a consulta preenche razão social, situação, atividade e endereço. Sem CNPJ, basta o nome.")}
          </p>

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={aoFechar}>
              {t("Cancelar")}
            </Button>
            <Button disabled={salvar.isPending} onClick={() => aoSalvar(false)}>
              {salvar.isPending ? t("Salvando…") : t("Salvar empresa")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
