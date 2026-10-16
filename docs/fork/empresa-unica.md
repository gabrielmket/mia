# Empresa única (fork MIA, .79)

Até a .78 o sistema tinha **dois cadastros de empresa sem ponte**: o do upstream
(`companies`, com `people` e `company_people`, o módulo B2B com a consulta à
Receita) e o nosso (`crm_empresas`, o das fichas, dos cartões, das obrigações e da
importação). A mesma padaria podia existir duas vezes, com pessoas diferentes em
cada uma. Item 7 do mapa de produção.

O protótipo clicável foi aprovado pelo Gabriel em 15/10/2026, sem comentários: as
onze respostas propostas valem. Esta versão entrega as partes 1 a 4 (banco, leitura,
tela e escrita, importação e MCP). A parte 5 (as pessoas do negócio alinhadas com o
upstream e a saída de `crm_empresas`) fica para depois, seção 8.

## 1. O desenho

**`companies` é o cadastro.** O que só nós temos mora AO LADO, em tabelas nossas, e
nenhum objeto do upstream é redefinido (docs/FORK-MIA.md, regra 3).

| tabela | de quem | o que guarda |
|---|---|---|
| `companies` | upstream | a empresa: nome, razão social, CNPJ (formatado e normalizado, único por organização), telefone, e-mail, os dados da Receita |
| `mia_companies_extra` | nossa (9032) | 1:1 pela chave: site, endereço em texto livre, observações, etiquetas, campos adicionais |
| `people` | upstream | a pessoa |
| `company_people` | upstream | a pessoa NA empresa: cargo, setor, decisor, principal; e a nossa coluna `papel` |
| `contacts.person_id` | upstream | o número (contato) é de uma pessoa; vários números, uma pessoa |
| `mia_companies_mescladas` | nossa (9032) | a lápide da fusão: a perdedora sai de `companies` e fica aqui, com a que ficou |
| `mia_companies_de_para` | nossa (9032) | de onde veio cada linha de `crm_empresas` e para onde foi |

**O contato guarda um ESPELHO.** `contacts.empresa_id`, `cargo`, `setor`,
`papel_na_empresa` e `principal_na_empresa` continuam existindo e dizem a empresa
que aparece no cartão e o vínculo da pessoa com ela. Quem só lê o contato (o
quadro, o agente, as automações, os relatórios, a LGPD) continua certo sem mudar.
O espelho é mantido por gatilho; ninguém escreve nele para mudar a verdade.

**Quem escreve do jeito de antes continua funcionando.** Gravar `empresa_id`, cargo
ou papel direto no contato (um SQL de semente, a importação do upstream, um caminho
esquecido) vira vínculo: empresa nova = vínculo novo e empresa do cartão; "sem
empresa" = sai o vínculo com a empresa do cartão.

**Uma chave de transação** (`mia.empresa_unica = 'propagando'`) impede o eco entre os
gatilhos: quem escreve dos dois lados liga a chave e devolve o valor de antes.

## 2. As migrations

| número | carimbo | o que faz |
|---|---|---|
| 9032 | `20261015190000` | as três tabelas ao lado, `company_people.papel` (lista fechada), um principal por empresa (índice `company_people_mia_um_principal_uidx`), RLS só de leitura nas tabelas novas, funções puras de CNPJ e nome |
| 9033 | `20261015200000` | a CÓPIA: `crm_empresas` → `companies` (mesmo id; ou casada pelo CNPJ; ou pelo nome, quando o nome é único dos dois lados), o que é só nosso para `mia_companies_extra`, as chaves estrangeiras repontadas para `companies`, uma pessoa e um vínculo por contato com empresa, e `crm_empresas` APOSENTADA |
| 9034 | `20261015210000` | as funções e os gatilhos (seção 3) |

O baseline é reaplicado a cada implantação, então a cópia roda de novo toda vez: ela
é idempotente pelo registro do de-para (linha copiada não é copiada de novo) e nada
se perde nem duplica. Provado em `tests/invariants/empresa-unica.test.ts` (seção 7)
e no ensaio com a produção de 28/09.

### Como `crm_empresas` ficou

Os dados ficam onde estavam (nada apagado). A política de escrita saiu e a sessão
perdeu INSERT, UPDATE e DELETE: a tabela só se lê. Nenhuma chave estrangeira aponta
mais para ela (contatos, negócios e obrigações apontam para `companies`, com as
restrições `<tabela>_<coluna>_mia_companies_fkey`), fora a dela própria
(`mesclada_com`). O comentário da tabela diz APOSENTADA. Nenhum código do app lê ou
escreve nela. Sai de vez na parte 5.

## 3. As regras (as onze decisões do protótipo)

| decisão | onde mora |
|---|---|
| CNPJ repetido é recusado, e a tela oferece abrir a que existe | `fn_mia_gravar_empresa` (erro `cnpj_ja_cadastrado` com o id no detalhe); `lib/empresas/respostas.ts` (409 com `details.existente`); `components/empresas/FormularioDaEmpresa.tsx` e `NovaEmpresa.tsx` |
| Nome parecido sem CNPJ avisa e deixa escolher; o agente usa a existente | `lib/empresas/parecida.ts`; a rota POST de `/api/v1/empresas` (409 `nome_parecido` até `criar_mesmo_assim`); `lib/empresas/achar-ou-criar.ts` (o agente); a lista marca "possível duplicada" |
| Um contato em várias empresas, uma delas no cartão | `fn_mia_vincular_pessoa` (`no_cartao`); a ficha do contato (`FichaConectadaDoContato.tsx`: "Mostrar esta no cartão", "+ Vincular a outra empresa") |
| Vários números = uma pessoa; cada número com a sua conversa | `fn_mia_juntar_numeros` e `fn_mia_separar_numero`; rota `/api/v1/contacts/[id]/mesma-pessoa`; o bloco "Números desta pessoa" na ficha do contato |
| Negócio sem empresa sempre permitido; a do contato entra sozinha e pode ser tirada | gatilho `trg_mia_negocio_e_a_empresa`; `components/empresas/CampoDaEmpresaDoNegocio.tsx` no novo negócio; "Tirar a empresa deste negócio" no cartão aberto |
| Excluir: recusa com negócio aberto; sem ele, as pessoas ficam sem empresa | `fn_mia_excluir_empresa` (gestor; `empresa_com_negocio_aberto` com a contagem); a ficha da empresa |
| Papéis em lista fechada; cargo é texto livre | `company_people_mia_papel_check` (o mesmo vocabulário de `lib/cartoes/papel.ts`) |
| O mesmo papel na empresa e no negócio; no negócio entra o da empresa e pode ser trocado | o bloco das pessoas do negócio no cartão aberto (`Blocos.tsx`, "Outras pessoas desta empresa") |
| Um principal por empresa, garantido pelo sistema | o índice único parcial e o gatilho `trg_mia_vinculo_antes` (quem vira principal tira o de antes) |
| Atendente, gestor e o agente criam empresa | `fn_mia_gravar_empresa` confere `agent`; o agente pela ferramenta `crm_registrar_empresa_do_contato`; o INSERT direto em `companies` segue só do gestor (a regra do upstream, invariante `companies-people-rls`) |
| Receita só pela tela, por uma pessoa; demonstração não consulta | `lib/empresas/receita.ts` (a trava da demonstração ANTES da rede); rotas `/api/v1/empresas/consultar-cnpj` e `/api/v1/empresas/[id]/receita`; as rotas do upstream (`/api/v1/companies/lookup`, `enrich`, o POST e o PATCH com enriquecimento, e a planilha de `/api/v1/imports`) recusam ou não enriquecem na demonstração |

As funções da sessão são `security definer`, conferem o papel com
`fn_role_at_least` sobre a organização pedida e, com `auth.uid()` nulo, valem como
servidor (o MCP de plataforma, o agente). Estão declaradas em
`tests/invariants/hardening-definer-varredura.test.ts`.

**LGPD.** Anonimizar um número tira os vínculos da pessoa quando nenhum outro
número vivo fala por ela; com outro número vivo, o vínculo fica (o upstream já
redige nome, cargo e setor). O pedido de acesso do titular entrega todas as empresas
em que a pessoa está (`empresas_vinculadas` em `lib/lgpd/export-collector.ts`).

## 4. A tela

**Uma porta só: `/app/companies`**, um cartão no hub. `/app/empresas` e
`/app/empresas/<id>` redirecionam (links salvos). A porta aparece quando o modo de
venda da empresa é **Para empresas** ou **Para empresas e para pessoas** (o modo
novo, `misto`); em **Para pessoas** ela some do menu. O módulo `crm_b2b` do
upstream deixa de ser condição para a tela de empresas: ele continua guardando
Pessoas e Importação, como o upstream escreveu.

- **A lista** (`components/empresas/ListaDeEmpresas.tsx`, `lib/empresas/lista.ts`):
  nome e razão social, CNPJ e a situação na Receita, pessoas (quantas e os primeiros
  nomes), negócios abertos, obrigações (em dia ou pedindo atenção) e "Parece" com
  qual outra. Busca por nome, razão social ou dígitos do CNPJ; filtros Todas, Com
  negócio aberto, Sem CNPJ e Possível duplicada, que valem para a organização
  inteira.
- **Nova empresa** (`NovaEmpresa.tsx`): CNPJ opcional; com ele, "Consultar" preenche
  pela Receita; CNPJ já cadastrado oferece abrir a existente; nome parecido oferece
  usar a existente ou criar mesmo assim.
- **A ficha** (`components/cartoes/fichas/FichaDaEmpresa.tsx`): os dados e o que é
  só nosso, as pessoas com papel, cargo e "★ principal" (e "Também está em" outras
  empresas), vincular pessoa, os negócios (os da empresa e os das pessoas dela sem
  empresa), as obrigações, os dados da Receita com "Atualizar pela Receita",
  Mesclar e Excluir (gestor), com as frases da recusa e do que acontece.
- **A ficha do contato**: as empresas da pessoa, cada uma com papel, cargo,
  principal e "a que aparece no cartão"; os números da mesma pessoa.
- **O cartão aberto**: as pessoas do negócio com o papel da empresa, as outras
  pessoas da empresa como sugestão, e tirar a empresa do negócio.

Campos e botões novos têm 44 px de altura no celular (`min-h-11 lg:min-h-0`) e
fonte de 16 px no celular. As frases em espanhol moram em
`lib/i18n/dicionario-empresas-mia.ts`.

## 5. Quem lê e quem escreve

Toda leitura de empresa passa por `lib/empresas/fonte-unica.ts`
(`lerEmpresa`, `lerTodasAsEmpresas`, `lerNomesDasEmpresas`): o quadro, o cartão
aberto, as fichas, as obrigações (leitura, operações, contexto da automação), a
implantação, a LGPD, o resumo do contato e a ferramenta do agente. O que é só nosso
é lido à parte e juntado pela chave, sem embed.

Toda escrita de empresa passa por `fn_mia_gravar_empresa` (`gravarEmpresa`), e
todo vínculo por `fn_mia_vincular_pessoa`: a tela, o agente, a importação pelo MCP e
a semente das demonstrações (esta grava direto, como serviço, nas mesmas tabelas).

## 6. Importação e MCP

- `plataforma_importar_empresas`: grava no cadastro único pela mesma porta da tela;
  nome parecido sem CNPJ entra como nova e o aviso diz com qual parece e como juntar.
- `plataforma_importar_contatos`: a empresa da linha vira vínculo com papel; em
  `completar`, empresa diferente da que o contato já tem vira MAIS um vínculo (a
  pessoa em duas empresas), sem trocar o cartão; em `atualizar`, troca o cartão.
- `plataforma_vincular_pessoas_a_empresas` (NOVA, `lib/mcp-plataforma/importacao/vinculos.ts`):
  liga contatos a empresas com papel, cargo, setor, principal e cartão, e junta
  números da mesma pessoa. Operação `importar_base`, teto de 200 itens.
- `plataforma_ver_importacao`: conta as empresas do cadastro único e os vínculos.
- `plataforma_configurar_empresa`: aceita o modo de venda `misto`.
- `crm_registrar_empresa_do_contato` (o agente): acha pelo nome (exato ou parecido,
  sempre a existente), cria pela porta da tela e liga pelo vínculo.
- A planilha do upstream (`lib/crm-b2b/import-process.ts`): sem CNPJ reaproveita a
  empresa de mesmo nome e não marca todo mundo como decisor.

## 7. Provas

| arquivo | o que prova |
|---|---|
| `tests/invariants/empresa-unica.test.ts` | as regras no banco de verdade: RLS das tabelas novas, criar pela porta e não direto, CNPJ repetido, leitor e vizinho recusados, várias empresas, um principal, papel fechado, o jeito de antes, o contato que nasce com empresa, o negócio que herda, excluir, mesclar, separar, anonimizar e a cópia rodando duas vezes |
| `tests/invariants/papel-do-contato-na-empresa.test.ts`, `obrigacoes*.test.ts`, `mcp-de-migracao-importa-em-silencio.test.ts`, `cliente-modelo-semente.test.ts`, `rls-tabelas-da-mia.test.ts` | os de antes, sobre o cadastro único |
| `tests/unit/empresa-unica-lista-e-receita.test.ts` | "parece a mesma", a lista e os filtros, a trava da Receita |
| `tests/unit/mcp-de-migracao-vinculos.test.ts` | a ferramenta nova do MCP |
| `tests/unit/fichas-conectadas-mia.test.tsx` | a ficha do contato com várias empresas e números |

## 8. O que fica para a parte 5

- As pessoas do NEGÓCIO alinhadas com o upstream (#1506): hoje o papel no negócio é o
  nosso (`lib/cartoes/papel.ts`).
- Tirar `crm_empresas` de vez (com o de-para guardado), e o espelho do contato, quando
  nenhuma leitura depender dele.
- A coluna "Responsável" da lista do protótipo: a empresa não tem dono no cadastro
  do upstream.
- Os outros telefones da linha na importação de contatos (hoje um número por linha;
  juntar é pela ferramenta de vínculos).
