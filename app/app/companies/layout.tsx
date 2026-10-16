/**
 * FORK MIA (.79, empresa única): esta tela EXISTE sem o módulo `crm_b2b`.
 *
 * No upstream, Empresas, Pessoas e Importação são módulo opcional da instalação,
 * desligado por padrão (doc 68), e o layout dava `notFound()` com ele desligado.
 * No fork, `/app/companies` é o cadastro ÚNICO de empresa (o que antes era
 * `/app/empresas`): a ficha do contato, o cartão do negócio, as obrigações e a
 * importação levam para cá, e a porta aparece para quem vende para empresas e
 * para quem vende dos dois jeitos (`modo_de_venda`, protótipo aprovado em
 * 15/10/2026). O modo esconde a PORTA (`lib/navigation/interface.ts`), não
 * tranca a tela. Pessoas e Importação continuam atrás do módulo, como ele as
 * escreveu. Ver docs/fork/empresa-unica.md.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
