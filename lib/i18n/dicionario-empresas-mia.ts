/**
 * FORK MIA (.79) · EMPRESA ÚNICA — as frases de tela da lista e da ficha da
 * empresa, da pessoa em várias empresas e dos números da mesma pessoa, em
 * espanhol (components/empresas/, components/cartoes/, app/app/settings/tenant/).
 *
 * Moram num arquivo NOSSO, espalhado no fim do `DICIONARIO` do upstream por uma
 * linha (`...DICIONARIO_EMPRESAS_MIA`), como as dos cartões e das obrigações:
 * a sincronização com o upstream não conflita a cada frase nova.
 *
 * ⚠️ Não repita aqui uma chave que o upstream (ou outro arquivo nosso) já
 * traduz: o espalhamento vem por último e VENCERIA a tradução de lá em silêncio.
 */
type Traducoes = Record<string, { es: string }>;

export const DICIONARIO_EMPRESAS_MIA: Traducoes = {
  // ─── o modo de venda (Configurações › Empresa) ───
  "Para empresas e para pessoas": { es: "Para empresas y para personas" },
  "A aba Empresas fica no menu e a empresa é sempre opcional: o contato que compra como pessoa física fica sem empresa, e o que compra por uma empresa fica ligado a ela.":
    {
      es: "La pestaña Empresas queda en el menú y la empresa siempre es opcional: el contacto que compra como persona física queda sin empresa, y el que compra por una empresa queda vinculado a ella.",
    },

  // ─── a lista (components/empresas/ListaDeEmpresas.tsx) ───
  "Os clientes que são empresa. Cada uma reúne as pessoas, os negócios e as obrigações dela.": {
    es: "Los clientes que son empresa. Cada una reúne sus personas, negocios y obligaciones.",
  },
  "Filtrar a lista": { es: "Filtrar la lista" },
  "Com negócio aberto": { es: "Con negocio abierto" },
  "Possível duplicada": { es: "Posible duplicada" },
  "Não consegui carregar as empresas. Tente de novo em instantes.": {
    es: "No pude cargar las empresas. Intenta de nuevo en unos instantes.",
  },
  "Clique numa linha para abrir a ficha.": { es: "Haz clic en una fila para abrir la ficha." },
  "Nenhuma empresa com esse filtro.": { es: "Ninguna empresa con ese filtro." },
  "na Receita": { es: "en la Receita Federal" },
  Parece: { es: "Se parece a" },
  "Sem CNPJ": { es: "Sin CNPJ" },
  "e mais": { es: "y" },
  "pedindo atenção": { es: "piden atención" },
  nenhuma: { es: "ninguna" },

  // ─── nova empresa e o formulário (components/empresas/NovaEmpresa.tsx, FormularioDaEmpresa.tsx) ───
  "Informe os 14 números do CNPJ.": { es: "Informa los 14 números del CNPJ." },
  "Não consegui consultar a Receita agora.": { es: "No pude consultar la Receita Federal ahora." },
  "CNPJ (opcional)": { es: "CNPJ (opcional)" },
  "Veio da Receita": { es: "Vino de la Receita Federal" },
  "aberta em": { es: "abierta el" },
  "Abrir a empresa": { es: "Abrir la empresa" },
  "Parece a mesma empresa": { es: "Parece la misma empresa" },
  "Usar a existente": { es: "Usar la existente" },
  "Informe pelo menos o nome da empresa.": { es: "Informa al menos el nombre de la empresa." },
  "Com CNPJ, a consulta preenche razão social, situação, atividade e endereço. Sem CNPJ, basta o nome.": {
    es: "Con CNPJ, la consulta completa razón social, situación, actividad y dirección. Sin CNPJ, basta el nombre.",
  },
  "Salvar empresa": { es: "Guardar empresa" },
  "Este CNPJ já está cadastrado": { es: "Este CNPJ ya está registrado" },
  "Não dá para cadastrar de novo.": { es: "No se puede registrar de nuevo." },
  "Não consegui salvar a empresa.": { es: "No pude guardar la empresa." },

  // ─── a ficha da empresa (components/cartoes/fichas/FichaDaEmpresa.tsx) ───
  "Parece a mesma empresa que": { es: "Parece la misma empresa que" },
  "Nome muito parecido e esta não tem CNPJ.": { es: "Nombre muy parecido y esta no tiene CNPJ." },
  "Mesclar as duas": { es: "Fusionar las dos" },
  "Razão social não informada": { es: "Razón social no informada" },
  "sem CNPJ": { es: "sin CNPJ" },
  Mesclar: { es: "Fusionar" },
  "Não dá para excluir: 1 negócio aberto com esta empresa.": {
    es: "No se puede eliminar: 1 negocio abierto con esta empresa.",
  },
  "Não dá para excluir: {n} negócios abertos com esta empresa.": {
    es: "No se puede eliminar: {n} negocios abiertos con esta empresa.",
  },
  "Encerre ou mova os negócios, ou mescle com outra empresa.": {
    es: "Cierra o mueve los negocios, o fusiónala con otra empresa.",
  },
  "1 pessoa fica como contato sem empresa.": { es: "1 persona queda como contacto sin empresa." },
  "{n} pessoas ficam como contato sem empresa.": { es: "{n} personas quedan como contacto sin empresa." },
  "Os negócios encerrados continuam no histórico, sem empresa.": {
    es: "Los negocios cerrados siguen en el historial, sin empresa.",
  },
  "Nenhuma pessoa vinculada. Use Vincular pessoa, acima.": {
    es: "Ninguna persona vinculada. Usa Vincular persona, arriba.",
  },
  "Também está em": { es: "También está en" },
  "Novo negócio com esta empresa": { es: "Nuevo negocio con esta empresa" },
  "Nenhum negócio com esta empresa.": { es: "Ningún negocio con esta empresa." },
  "Dados da Receita": { es: "Datos de la Receita Federal" },
  Abertura: { es: "Apertura" },
  "Ainda não consultada na Receita.": { es: "Todavía no consultada en la Receita Federal." },
  "Atualizar pela Receita": { es: "Actualizar desde la Receita Federal" },
  Consultado: { es: "Consultado" },
  "Sem CNPJ, não há o que consultar. A empresa funciona normalmente só com o nome.": {
    es: "Sin CNPJ, no hay nada que consultar. La empresa funciona normalmente solo con el nombre.",
  },
  "Informar o CNPJ": { es: "Informar el CNPJ" },
  "É o contato principal desta empresa": { es: "Es el contacto principal de esta empresa" },
  "O principal de hoje deixa de ser.": { es: "El principal de hoy deja de serlo." },
  "Se a pessoa ainda não é contato, ela é criada pela conversa ou pela tela de contatos, e depois vinculada aqui.": {
    es: "Si la persona todavía no es contacto, se crea desde la conversación o desde la pantalla de contactos, y después se vincula aquí.",
  },
  "Mesclar empresas": { es: "Fusionar empresas" },
  "A empresa que fica": { es: "La empresa que se queda" },
  "O que acontece": { es: "Qué sucede" },
  pessoa: { es: "persona" },
  pessoas: { es: "personas" },
  "e as obrigações de": { es: "y las obligaciones de" },
  "passam para": { es: "pasan a" },
  "A empresa antiga sai da lista, e quem tiver o endereço dela salvo cai na que ficou.": {
    es: "La empresa antigua sale de la lista, y quien tenga su dirección guardada llega a la que se quedó.",
  },
  "Falha ao juntar as empresas.": { es: "Falló la fusión de las empresas." },

  // ─── a ficha do contato: números e empresas (components/cartoes/fichas/FichaConectadaDoContato.tsx) ───
  "Outro número desta pessoa": { es: "Otro número de esta persona" },
  "Números desta pessoa": { es: "Números de esta persona" },
  "{n} números, a mesma pessoa. Cada número continua com a sua conversa; a ficha, a empresa e os negócios são um só.": {
    es: "{n} números, la misma persona. Cada número sigue con su conversación; la ficha, la empresa y los negocios son uno solo.",
  },
  "É a mesma pessoa": { es: "Es la misma persona" },
  "Juntar outro número": { es: "Unir otro número" },
  "Separar este número": { es: "Separar este número" },
  "Sem empresa. É o normal para quem compra como pessoa física.": {
    es: "Sin empresa. Es lo normal para quien compra como persona física.",
  },
  "a que aparece no cartão": { es: "la que aparece en la tarjeta" },
  "cargo não informado": { es: "cargo no informado" },
  "contato principal da empresa": { es: "contacto principal de la empresa" },
  "Mostrar esta no cartão": { es: "Mostrar esta en la tarjeta" },
  "Tirar da empresa": { es: "Quitar de la empresa" },
  "Cargo (opcional)": { es: "Cargo (opcional)" },
  "Vincular a esta empresa": { es: "Vincular a esta empresa" },
  "Vincular a outra empresa": { es: "Vincular a otra empresa" },

  // ─── o cartão aberto e o negócio (components/cartoes/aberto/Blocos.tsx, components/empresas/CampoDaEmpresaDoNegocio.tsx) ───
  "Outras pessoas desta empresa": { es: "Otras personas de esta empresa" },
  "O papel aqui vale só para este negócio. Ao adicionar alguém da empresa, entra o papel que a pessoa tem lá, e pode ser trocado.":
    {
      es: "El rol aquí vale solo para este negocio. Al agregar a alguien de la empresa, entra el rol que la persona tiene allí, y se puede cambiar.",
    },
  "Tirar a empresa deste negócio": { es: "Quitar la empresa de este negocio" },
  "Este contato não tem empresa: o negócio nasce sem empresa, e está tudo certo.": {
    es: "Este contacto no tiene empresa: el negocio nace sin empresa, y está todo bien.",
  },
  "Este contato está em {n} empresas. Entrou a que aparece no cartão dele; troque se o negócio for da outra.": {
    es: "Este contacto está en {n} empresas. Entró la que aparece en su tarjeta; cámbiala si el negocio es de la otra.",
  },
  "A empresa do contato entrou sozinha. Pode trocar ou tirar.": {
    es: "La empresa del contacto entró sola. Puedes cambiarla o quitarla.",
  },
};
