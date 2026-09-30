/**
 * FORK MIA — o texto que foi ao grupo do time aparece na linha do tempo do
 * negócio, e só nas linhas do aviso.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LeadTimeline } from "@/components/kanban/LeadTimeline";
import type { TimelineItemView } from "@/lib/types/contacts";

function linha(over: Partial<TimelineItemView>): TimelineItemView {
  return {
    id: "a1",
    organization_id: "o",
    lead_id: "l",
    contact_id: "c",
    source_module: "automation",
    source_id: "r",
    type: "group_notice_sent",
    payload: { texto: "🔔 Lead qualificado: Roberto\nImplante · São Miguel" },
    metadata: {},
    performed_at: "2026-09-29T12:00:00Z",
    performed_by_user_id: null,
    actor_kind: "rule",
    reason: "Aviso enviado ao grupo «Comercial» pela regra «Qualificado».",
    ...over,
  };
}

describe("o aviso ao time na timeline do negócio", () => {
  it("⭐ mostra o rótulo, o porquê e o texto que foi ao grupo", () => {
    render(<LeadTimeline itens={[linha({})]} chegouAoVivo={new Set()} isLoading={false} isError={false} />);
    expect(screen.getByText("Aviso enviado ao time no grupo")).toBeTruthy();
    expect(screen.getByText(/pela regra «Qualificado»/)).toBeTruthy();
    expect(screen.getByTestId("texto-do-aviso-ao-time").textContent).toContain("Implante · São Miguel");
  });

  it("a falha também aparece, com o rótulo dela", () => {
    render(
      <LeadTimeline
        itens={[linha({ id: "a2", type: "group_notice_failed", reason: "O aviso da regra «Q» não saiu: x." })]}
        chegouAoVivo={new Set()}
        isLoading={false}
        isError={false}
      />,
    );
    expect(screen.getByText("O aviso ao time não saiu")).toBeTruthy();
  });

  it("outra linha qualquer não ganha o bloco do texto", () => {
    render(
      <LeadTimeline
        itens={[linha({ id: "a3", type: "note", payload: { texto: "não é aviso" } })]}
        chegouAoVivo={new Set()}
        isLoading={false}
        isError={false}
      />,
    );
    expect(screen.queryByTestId("texto-do-aviso-ao-time")).toBeNull();
  });
});
