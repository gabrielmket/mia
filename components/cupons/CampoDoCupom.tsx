"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { normalizarCodigo } from "@/lib/cupons/regras";

/** FORK MIA (.98) · O campo "Tenho um cupom", com a mensagem de erro embaixo. */
export function CampoDoCupom({
  aoAplicar,
  erro,
  ocupado = false,
  prefixo = "cupom",
}: {
  aoAplicar: (codigo: string) => void | Promise<void>;
  erro?: string | null;
  ocupado?: boolean;
  prefixo?: string;
}) {
  const t = useT();
  const [codigo, setCodigo] = useState("");
  const aplicar = () => {
    void aoAplicar(normalizarCodigo(codigo));
  };
  return (
    <div className="space-y-1.5" data-cupom="campo">
      <Label htmlFor={`${prefixo}-codigo`}>{t("Tenho um cupom")}</Label>
      <div className="flex gap-2">
        <Input
          id={`${prefixo}-codigo`}
          value={codigo}
          autoComplete="off"
          maxLength={40}
          placeholder={t("Ex.: JOAO10")}
          className="uppercase"
          onChange={(ev) => setCodigo(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === "Enter") {
              ev.preventDefault();
              aplicar();
            }
          }}
        />
        <Button type="button" variant="outline" disabled={ocupado} onClick={aplicar}>
          {t("Aplicar")}
        </Button>
      </div>
      {erro ? (
        <p className="text-xs text-destructive" role="alert" data-cupom="erro">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
