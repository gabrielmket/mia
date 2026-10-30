/**
 * FORK MIA (.97) · as frases dos CONTATOS EM MASSA, em espanhol: o telefone na
 * importação, o "Selecionar todos os N contatos deste filtro" e a conferência do
 * Broadcast que diz por que a lista ficou vazia.
 *
 * Mora num arquivo NOSSO, espalhado no `DICIONARIO` do upstream por uma linha,
 * para a sincronização com o upstream não conflitar a cada frase nova
 * (docs/FORK-MIA.md, regra 1). A chave é o texto em português.
 *
 * ⚠️ Não repita aqui uma chave que o upstream ou outro dicionário do fork já traduz.
 */
type Traducoes = Record<string, { es: string }>;

export const DICIONARIO_DOS_CONTATOS_EM_MASSA: Traducoes = {
  // ── a importação ──
  "Envie um arquivo .csv com cabeçalho. Colunas reconhecidas: nome, telefone, email, cpf, nascimento, tags. Quem já está na base não é duplicado: a importação só completa o telefone ou o e-mail que faltar. Excel: use “Salvar como” → “CSV UTF-8”. Máximo de 2000 linhas por arquivo.":
    {
      es: "Envía un archivo .csv con encabezado. Columnas reconocidas: nombre, teléfono, email, cpf, nacimiento, etiquetas. Quien ya está en la base no se duplica: la importación solo completa el teléfono o el correo que falte. Excel: usa “Guardar como” → “CSV UTF-8”. Máximo de 2000 líneas por archivo.",
    },
  "telefone(s) completado(s)": { es: "teléfono(s) completado(s)" },
  "e-mail(s) completado(s)": { es: "correo(s) completado(s)" },
  "Nenhuma coluna desta planilha foi reconhecida como telefone. Use um destes nomes no cabeçalho: telefone, celular, whatsapp ou phone, e importe de novo: quem já entrou é completado, sem duplicar.":
    {
      es: "Ninguna columna de esta hoja se reconoció como teléfono. Usa uno de estos nombres en el encabezado: teléfono, celular, whatsapp o phone, e importa de nuevo: quien ya entró se completa, sin duplicar.",
    },
  "Contato sem telefone fica na base, mas não recebe WhatsApp nem disparo.": {
    es: "El contacto sin teléfono queda en la base, pero no recibe WhatsApp ni envíos masivos.",
  },
  "Colunas ignoradas:": { es: "Columnas ignoradas:" },
  "Não consegui conferir quem já está na base. Tente de novo.": {
    es: "No pude comprobar quién ya está en la base. Inténtalo de nuevo.",
  },
  "O telefone é de um contato e o e-mail é de outro. Nada foi mudado: confira em Duplicados.": {
    es: "El teléfono es de un contacto y el correo es de otro. No se cambió nada: revísalo en Duplicados.",
  },
  "O contato deste e-mail já tem outro telefone, e ele foi mantido.": {
    es: "El contacto de este correo ya tiene otro teléfono, y se mantuvo.",
  },
  "O contato deste telefone já tem outro e-mail, e ele foi mantido.": {
    es: "El contacto de este teléfono ya tiene otro correo, y se mantuvo.",
  },

  // ── selecionar o filtro inteiro ──
  "Todos os contatos deste filtro estão selecionados.": {
    es: "Todos los contactos de este filtro están seleccionados.",
  },
  "Todos os {n} contatos deste filtro estão selecionados.": {
    es: "Los {n} contactos de este filtro están seleccionados.",
  },
  "O contato carregado está selecionado.": { es: "El contacto cargado está seleccionado." },
  "Os {n} contatos carregados estão selecionados.": { es: "Los {n} contactos cargados están seleccionados." },
  "Selecionar todos os contatos deste filtro": { es: "Seleccionar todos los contactos de este filtro" },
  "Selecionar todos os {n} contatos deste filtro": { es: "Seleccionar los {n} contactos de este filtro" },
  "{n} contatos já processados": { es: "{n} contactos ya procesados" },
  "{n} de {total} contatos já processados": { es: "{n} de {total} contactos ya procesados" },
  "Não feche esta tela até terminar.": { es: "No cierres esta pantalla hasta que termine." },
  "Vale para {n} contatos deste filtro, e não só para os da tela.": {
    es: "Vale para {n} contactos de este filtro, no solo para los de la pantalla.",
  },
  "Automação que olha a etiqueta nova roda para cada um.": {
    es: "La automatización que mira la etiqueta nueva se ejecuta para cada uno.",
  },
  "1 contato etiquetado.": { es: "1 contacto etiquetado." },
  "{n} contatos etiquetados.": { es: "{n} contactos etiquetados." },
  "Etiqueta removida de 1 contato.": { es: "Etiqueta quitada de 1 contacto." },
  "Etiqueta removida de {n} contatos.": { es: "Etiqueta quitada de {n} contactos." },
  "A ação parou antes do fim: repita para continuar.": {
    es: "La acción se detuvo antes del final: repítela para continuar.",
  },

  // ── a conferência do Broadcast ──
  "sem negócio aberto na etapa": { es: "sin negocio abierto en la etapa" },
  "Nenhum contato tem esta etiqueta e negócio aberto nesta etapa. Volte e confira as etiquetas e a etapa marcadas.": {
    es: "Ningún contacto tiene esta etiqueta y un negocio abierto en esta etapa. Vuelve y revisa las etiquetas y la etapa marcadas.",
  },
  "Nenhum contato tem esta etiqueta. Volte e confira a etiqueta marcada.": {
    es: "Ningún contacto tiene esta etiqueta. Vuelve y revisa la etiqueta marcada.",
  },
  "Nenhum contato tem negócio aberto nesta etapa. Volte e confira a etapa marcada.": {
    es: "Ningún contacto tiene un negocio abierto en esta etapa. Vuelve y revisa la etapa marcada.",
  },
  "A empresa ainda não tem contatos.": { es: "La empresa todavía no tiene contactos." },
};
