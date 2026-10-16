"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { mensagemDoErro, novoPainel } from "@/components/relatorios/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";

/** FORK MIA (item 9) — "Novo painel": o nome, e o painel abre vazio para receber relatórios. */
export function NovoPainel() {
  const t = useT();
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function criar() {
    setOcupado(true);
    try {
      const p = await novoPainel({ nome: nome.trim() || t("Meu painel") });
      router.push(`/app/relatorios/paineis/${p.id}`);
    } catch (e) {
      toast.error(mensagemDoErro(e, t));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form
      className="flex w-full flex-col gap-2 sm:flex-row md:w-auto"
      onSubmit={(e) => {
        e.preventDefault();
        void criar();
      }}
    >
      <label className="min-w-0 flex-1">
        <span className="sr-only">{t("Nome do painel")}</span>
        <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} placeholder={t("Ex.: Painel comercial")} />
      </label>
      <Button type="submit" disabled={ocupado}>
        {t("Novo painel")}
      </Button>
    </form>
  );
}
