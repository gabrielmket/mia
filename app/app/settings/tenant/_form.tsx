"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateTenant } from "@/app/actions/settings/updateTenant";
import { useT } from "@/hooks/i18n/useT";
import { MOEDAS_SERVIDAS, simboloDaMoeda, type MoedaServida } from "@/lib/money";
import { tenantSchema, type Locale, type TenantInput } from "@/lib/schemas/settings";

interface Props {
  initial: TenantInput;
}

const TIMEZONES = [
  "America/Sao_Paulo",
  "America/Manaus",
  "America/Belem",
  "America/Recife",
  "America/Fortaleza",
  "UTC",
];

export function TenantForm({ initial }: Props) {
  const t = useT();
  const [form, setForm] = useState<TenantInput>(initial);
  const [reasonsText, setReasonsText] = useState(
    (initial.lost_reasons_extra ?? []).join(", "),
  );
  const [isPending, startTransition] = useTransition();

  function set<K extends keyof TenantInput>(key: K, value: TenantInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const reasons = reasonsText
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const candidate = { ...form, lost_reasons_extra: reasons };
    const parsed = tenantSchema.safeParse(candidate);
    if (!parsed.success) {
      toast.error(t("Dados inválidos."));
      return;
    }
    startTransition(async () => {
      const r = await updateTenant(parsed.data);
      if (r.ok) toast.success(t("Organização atualizada."));
      else toast.error(`${t("Erro")}: ${r.error}`);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl">
      <Card className="space-y-4 p-6">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="display_name">{t("Nome de exibição")}</Label>
            <Input
              id="display_name"
              value={form.display_name}
              onChange={(e) => set("display_name", e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="legal_name">{t("Razão social")}</Label>
            <Input
              id="legal_name"
              value={form.legal_name}
              onChange={(e) => set("legal_name", e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cnpj">{t("CNPJ")}</Label>
            <Input
              id="cnpj"
              value={form.cnpj ?? ""}
              onChange={(e) => set("cnpj", e.target.value || null)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dpo_email">{t("DPO email")}</Label>
            <Input
              id="dpo_email"
              type="email"
              value={form.dpo_email ?? ""}
              onChange={(e) => set("dpo_email", e.target.value || null)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="timezone">{t("Fuso horário")}</Label>
            <Select value={form.timezone} onValueChange={(v) => set("timezone", v)}>
              <SelectTrigger id="timezone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="locale">{t("Idioma")}</Label>
            <Select
              value={form.locale}
              onValueChange={(v) => set("locale", v as Locale)}
            >
              <SelectTrigger id="locale">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pt-BR">Português (BR)</SelectItem>
                <SelectItem value="es">Español</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="currency">{t("Moeda")}</Label>
            <Select
              value={form.currency}
              onValueChange={(v) => set("currency", v as MoedaServida)}
            >
              <SelectTrigger id="currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MOEDAS_SERVIDAS.map((moeda) => (
                  <SelectItem key={moeda} value={moeda}>
                    {moeda} · {simboloDaMoeda(moeda)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t("Vale para todo preço do catálogo. Produto já cadastrado guarda a moeda com que nasceu.")}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="media_retention_days">{t("Retenção de mídia (dias)")}</Label>
            <Input
              id="media_retention_days"
              type="number"
              min={30}
              max={3650}
              value={form.media_retention_days}
              onChange={(e) => set("media_retention_days", Number(e.target.value))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="privacy_policy_url">{t("URL política de privacidade")}</Label>
            <Input
              id="privacy_policy_url"
              type="url"
              value={form.privacy_policy_url ?? ""}
              onChange={(e) => set("privacy_policy_url", e.target.value || null)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="lost_reasons">{t("Motivos de perda extras (separados por vírgula)")}</Label>
          <Input
            id="lost_reasons"
            value={reasonsText}
            onChange={(e) => setReasonsText(e.target.value)}
            placeholder={t("ex: Sem orçamento, Concorrente")}
          />
          <p className="text-xs text-muted-foreground">
            {t("Adicionados ao set padrão. Cada pipeline pode ter seus próprios motivos.")}
          </p>
        </div>

        {/*
          Item C2 — B2B ou B2C.

          É uma escolha de CADASTRO e mora aqui, ao lado da razão social, e não
          numa tela de aparência: o que ela decide não é estética, é se o
          produto vai pedir dado de empresa a quem vende para pessoa. E o item
          mais caro não é a aba nem o campo — é a capacidade que faz a IA
          perguntar "de qual empresa você é?" a alguém que quer marcar uma aula
          experimental.

          Os dois textos dizem o EFEITO, não o rótulo: "B2B" e "B2C" não
          explicam a ninguém o que some da tela.
        */}
        <div className="space-y-2">
          <Label htmlFor="modo_de_venda">{t("Para quem esta empresa vende")}</Label>
          <select
            id="modo_de_venda"
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
            value={form.modo_de_venda}
            onChange={(e) => set("modo_de_venda", e.target.value as TenantInput["modo_de_venda"])}
          >
            <option value="b2b">{t("Para outras empresas")}</option>
            <option value="b2c">{t("Direto para pessoas")}</option>
          </select>
          <p className="text-xs text-muted-foreground">
            {form.modo_de_venda === "b2c"
              ? t(
                  "A aba Empresas some do menu, o cadastro deixa de pedir empresa, cargo e setor, e a IA não oferece mais a capacidade de anotar a empresa do cliente. Os dados já cadastrados continuam no banco.",
                )
              : t(
                  "O sistema agrupa contatos e negócios por empresa: a aba Empresas fica no menu, o cadastro pede empresa, cargo e setor, e a IA pode anotar de qual empresa o cliente é.",
                )}
          </p>
        </div>

        <div className="flex sm:justify-end">
          <Button type="submit" disabled={isPending} className="w-full sm:w-auto">
            {isPending ? t("Salvando…") : t("Salvar")}
          </Button>
        </div>
      </Card>
    </form>
  );
}
