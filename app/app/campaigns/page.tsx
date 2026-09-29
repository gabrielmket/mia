import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// FORK MIA (1.21.0-mia.58): a lista de Campanhas é a lista do Broadcast, que
// junta os disparos pelo número oficial e pelo número por QR
// (docs/fork/broadcast-unificado.md). Quem chega aqui por link salvo, pelo
// "← Campanhas" do detalhe ou pelo "Cancelar" do formulário cai lá. A lista do
// upstream continua em `./_client.tsx`, intacta, para a fusão não conflitar.
export default function CampanhasPage() {
  redirect("/app/broadcast");
}
