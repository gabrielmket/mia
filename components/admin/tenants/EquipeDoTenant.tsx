"use client";

/**
 * QUEM TEM ACESSO A ESTE CLIENTE.
 *
 * A aba existia marcada `disabled` — uma aba que não abre é pior que uma aba
 * ausente: promete a informação, e quem precisa dela conclui que o produto a
 * tem em algum lugar que ele não achou.
 *
 * A pergunta é de operação: quando o cliente diz "ninguém está vendo as
 * conversas", o que se confere primeiro é quem de fato tem acesso, com que
 * papel, e se o convite chegou a ser aceito. Por isso "convidado" e "nunca
 * entrou" têm destaque próprio — são as duas respostas mais frequentes, e
 * escondê-las numa coluna cinza faria a tela existir sem resolver a ligação.
 */
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useEquipeDoTenant } from "@/hooks/useEquipeDoTenant";

function tom(estado: string): "default" | "secondary" | "destructive" | "outline" {
  if (estado === "revogado") return "destructive";
  if (estado === "convidado") return "secondary";
  return "default";
}

export function EquipeDoTenant({ organizationId }: { organizationId: string }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const { data, isLoading, error } = useEquipeDoTenant(organizationId);

  if (isLoading) return <p className="text-sm text-text-muted">{t("Carregando…")}</p>;
  if (error || !data) {
    return <p className="text-sm text-error-fg">{t("Não consegui carregar a equipe agora.")}</p>;
  }
  if (data.equipe.length === 0) {
    return (
      <p className="text-sm text-text-muted">
        {t("Ninguém tem acesso a esta conta ainda.")}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("Pessoa")}</TableHead>
            <TableHead>{t("Papel")}</TableHead>
            <TableHead>{t("Situação")}</TableHead>
            <TableHead>{t("Último acesso")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.equipe.map((p) => (
            <TableRow key={p.user_id}>
              <TableCell>
                <div className="font-medium">{p.nome ?? p.email ?? p.user_id}</div>
                {p.nome && p.email && (
                  <div className="text-xs text-text-muted">{p.email}</div>
                )}
              </TableCell>
              <TableCell>{p.role}</TableCell>
              <TableCell>
                <Badge variant={tom(p.estado)}>{t(p.estado)}</Badge>
              </TableCell>
              <TableCell>
                {/* "Nunca entrou" explica sozinho o "não estou conseguindo
                    acessar" — e um traço no lugar dele esconderia a resposta. */}
                {p.ultimo_acesso
                  ? new Date(p.ultimo_acesso).toLocaleString(tag)
                  : t("nunca entrou")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
