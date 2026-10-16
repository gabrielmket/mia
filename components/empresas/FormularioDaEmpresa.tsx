"use client";

/**
 * FORK MIA — editar a empresa (os dados que a equipe escreve).
 *
 * Desde a .79 (empresa única) mora aqui, e não mais na página `/app/empresas`,
 * que virou um redirecionamento para `/app/companies`. O formulário nasce com o
 * que já existe na ficha e manda só o que foi mexido: o PATCH grava chave por
 * chave, e o que não veio fica como está. CNPJ repetido é recusado com o nome
 * da empresa que já o tem.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CustomFieldsEditor, type CustomFieldDef } from "@/components/contacts/CustomFieldsEditor";
import { useT } from "@/hooks/i18n/useT";
import { useSalvarEmpresa, type Empresa, type EmpresaEntrada } from "@/hooks/useEmpresas";
import { ApiError } from "@/lib/api/types";
import { formatarCnpj } from "@/lib/empresas/formato";

type Texto = "nome" | "razao_social" | "cnpj" | "telefone" | "email" | "site" | "endereco" | "observacoes";

export function FormularioDaEmpresa({
  empresa,
  aoFechar,
  camposExtras,
  focarCnpj = false,
}: {
  empresa: Empresa;
  aoFechar: () => void;
  /**
   * As DEFINIÇÕES vêm de `crm_pipelines.settings.fields`, o mesmo registro que
   * o contato e o lead usam. Lista vazia = a seção some.
   */
  camposExtras: CustomFieldDef[];
  /** Abrir com o cursor no CNPJ ("Informar o CNPJ" da ficha sem CNPJ). */
  focarCnpj?: boolean;
}) {
  const t = useT();
  const salvar = useSalvarEmpresa();
  const [dados, setDados] = useState<EmpresaEntrada>({});
  const [erro, setErro] = useState<string | null>(null);

  const valor = (campo: Texto) => {
    const mexido = dados[campo];
    if (typeof mexido === "string") return mexido;
    const atual = empresa[campo];
    if (campo === "cnpj") return formatarCnpj(atual as string | null) ?? "";
    return typeof atual === "string" ? atual : "";
  };

  const campo = (chave: Texto, rotulo: string, extras?: { placeholder?: string; autoFocus?: boolean }) => (
    <div className="space-y-1">
      <Label htmlFor={`empresa-${chave}`}>{rotulo}</Label>
      <Input
        id={`empresa-${chave}`}
        value={valor(chave)}
        placeholder={extras?.placeholder}
        autoFocus={extras?.autoFocus}
        onChange={(e) => setDados((d) => ({ ...d, [chave]: e.target.value }))}
      />
    </div>
  );

  const enviar = () => {
    setErro(null);
    salvar.mutate(
      { id: empresa.id, dados },
      {
        onSuccess: () => {
          setDados({});
          aoFechar();
        },
        onError: (e) => {
          if (e instanceof ApiError && e.code === "cnpj_ja_cadastrado") {
            const existente = (e.details as { existente?: { nome?: string } | null } | undefined)?.existente;
            setErro(
              existente?.nome
                ? `${t("Este CNPJ já está cadastrado")}: ${existente.nome}. ${t("Não dá para cadastrar de novo.")}`
                : e.message,
            );
          } else setErro(e instanceof Error ? e.message : t("Não consegui salvar a empresa."));
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("Editar empresa")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {campo("nome", t("Nome da empresa"))}
          {campo("razao_social", t("Razão social"))}
          {campo("cnpj", t("CNPJ"), { placeholder: "00.000.000/0000-00", autoFocus: focarCnpj })}
          {campo("telefone", t("Telefone"))}
          {campo("email", t("E-mail"))}
          {campo("site", t("Site"))}
          {campo("endereco", t("Endereço"))}
        </div>
        {camposExtras.length > 0 && (
          <div className="space-y-2 rounded-md border border-border p-3">
            <h3 className="text-sm font-medium">{t("Campos personalizados")}</h3>
            <CustomFieldsEditor
              fields={camposExtras}
              value={(dados.custom_fields ?? empresa.custom_fields ?? {}) as Record<string, unknown>}
              onChange={(v) => setDados((d) => ({ ...d, custom_fields: v }))}
            />
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="empresa-observacoes">{t("Observações")}</Label>
          <Textarea
            id="empresa-observacoes"
            rows={3}
            className="text-base md:text-sm"
            value={valor("observacoes")}
            onChange={(e) => setDados((d) => ({ ...d, observacoes: e.target.value }))}
          />
        </div>
        {erro ? (
          <p role="alert" className="text-sm text-error-fg">
            {erro}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar}>
            {t("Cancelar")}
          </Button>
          <Button disabled={salvar.isPending || Object.keys(dados).length === 0} onClick={enviar}>
            {t("Salvar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
