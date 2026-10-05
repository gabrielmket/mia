/**
 * FORK MIA — as frases de tela das conversões da Meta que continuam nossas
 * (a chave dos leads de formulário, o diagnóstico da Meta e a seção Origem do
 * cartão aberto), em espanhol. Desde a .72 a régua por etapa e o histórico são
 * os do upstream, e as frases deles moram no dicionário dele.
 *
 * Moram num arquivo NOSSO, espalhado no `DICIONARIO` do upstream por uma linha
 * (`...DICIONARIO_DAS_CONVERSOES_DA_META`), para a sincronização com o upstream
 * não conflitar a cada frase nova (docs/FORK-MIA.md, regra 1). O espalhamento
 * vem ANTES das frases dele: uma chave igual do upstream prevalece.
 *
 * A regra é a do dicionário dele: a chave é o texto em português.
 */
type Traducoes = Record<string, { es: string }>;

export const DICIONARIO_DAS_CONVERSOES_DA_META: Traducoes = {
  // ─── o que cada etapa informa à Meta ───────────────────────────────────────
  "O que cada etapa do funil informa à Meta": { es: "Lo que cada etapa del embudo informa a Meta" },
  "Crie um funil com etapas para escolher o que cada etapa informa à Meta.": {
    es: "Crea un embudo con etapas para elegir lo que cada etapa informa a Meta.",
  },
  "alterações não salvas": { es: "cambios sin guardar" },
  "informa a Meta": { es: "informa a Meta" },
  "não informa": { es: "no informa" },
  "Vale para os negócios que entrarem nas etapas a partir de agora.": {
    es: "Vale para los negocios que entren en las etapas a partir de ahora.",
  },
  "Confira e salve.": { es: "Revisa y guarda." },
  "valor fixo": { es: "valor fijo" },
  "valor do negócio": { es: "valor del negocio" },
  "Sem valor": { es: "Sin valor" },
  "Valor fixo": { es: "Valor fijo" },
  "Valor do negócio": { es: "Valor del negocio" },
  "Novo lead": { es: "Nuevo lead" },
  Agendou: { es: "Agendó" },
  "Todos os canais": { es: "Todos los canales" },
  "Só WhatsApp": { es: "Solo WhatsApp" },
  "Só fora do WhatsApp": { es: "Solo fuera de WhatsApp" },

  // ─── como a Meta vai enxergar o funil ──────────────────────────────────────
  "ao entrar em": { es: "al entrar en" },
  "quando o negócio é ganho": { es: "cuando el negocio se gana" },

  // ─── leads de formulário voltam para a Meta ────────────────────────────────
  "Leads de formulário da Meta voltam para a Meta": { es: "Los leads de formulario de Meta vuelven a Meta" },
  "O sistema recebe os leads dos formulários da Meta e guarda o identificador de cada um, mas a Meta não fica sabendo quais viraram venda. Ligada, cada etapa com regra ligada no quadro acima e a venda também são informadas para o lead que veio de formulário, mesmo sem clique em anúncio de WhatsApp.":
    {
      es: "El sistema recibe los leads de los formularios de Meta y guarda el identificador de cada uno, pero Meta no se entera de cuáles se volvieron venta. Activada, cada etapa con regla activa en el cuadro de arriba y la venta también se informan para el lead que vino de un formulario, incluso sin clic en un anuncio de WhatsApp.",
    },
  "Saem para a Meta o identificador do lead, o evento, o valor da venda e o telefone e o e-mail do contato em forma embaralhada. Vem desligada: ligue só se a sua política de privacidade cobre esse uso. Ligar não envia o passado.":
    {
      es: "Salen hacia Meta el identificador del lead, el evento, el valor de la venta y el teléfono y el correo del contacto en forma cifrada. Viene desactivada: actívala solo si tu política de privacidad cubre ese uso. Activarla no envía lo pasado.",
    },
  "Ligada: a Meta fica sabendo o que aconteceu com cada lead de formulário.": {
    es: "Activada: Meta se entera de lo que pasó con cada lead de formulario.",
  },
  "Desligada: lead de formulário não volta para a Meta.": {
    es: "Desactivada: el lead de formulario no vuelve a Meta.",
  },
  "Ligada. Vale para o que acontecer com os leads de formulário a partir de agora.": {
    es: "Activada. Vale para lo que pase con los leads de formulario a partir de ahora.",
  },
  "Desligada. Lead de formulário não volta mais para a Meta.": {
    es: "Desactivada. El lead de formulario ya no vuelve a Meta.",
  },
  Desde: { es: "Desde" },

  // ─── diagnóstico da Meta ───────────────────────────────────────────────────
  "Saúde da integração com a Meta": { es: "Salud de la integración con Meta" },
  "O teste confere, na hora, se a Meta aceita o token, se o destino de conversões existe e o que foi aceito e recusado nos últimos dias. Nenhum evento é enviado pelo teste.":
    {
      es: "La prueba comprueba, al momento, si Meta acepta el token, si el destino de conversiones existe y qué se aceptó y se rechazó en los últimos días. La prueba no envía ningún evento.",
    },
  "Testar conexão": { es: "Probar conexión" },
  "Testando a conexão com a Meta...": { es: "Probando la conexión con Meta..." },
  "Ainda não testado nesta visita.": { es: "Aún no probado en esta visita." },
  "Ver no histórico": { es: "Ver en el historial" },
  "há instantes": { es: "hace instantes" },
  minutos: { es: "minutos" },
  hora: { es: "hora" },
  horas: { es: "horas" },
  dia: { es: "día" },
  dias: { es: "días" },
  "A Meta não está conectada": { es: "Meta no está conectada" },
  "Envio pausado": { es: "Envío en pausa" },
  "Conexão incompleta": { es: "Conexión incompleta" },
  "Instalação sem a chave de criptografia": { es: "Instalación sin la clave de cifrado" },
  "Não consegui ler a conexão agora": { es: "No pude leer la conexión ahora" },
  "Token válido": { es: "Token válido" },
  "Token recusado pela Meta": { es: "Token rechazado por Meta" },
  "Token: não deu para conferir": { es: "Token: no se pudo comprobar" },
  "Destino de conversões encontrado": { es: "Destino de conversiones encontrado" },
  "Destino de conversões não encontrado": { es: "Destino de conversiones no encontrado" },
  "Sem acesso ao destino de conversões": { es: "Sin acceso al destino de conversiones" },
  "Destino de conversões: não deu para conferir": { es: "Destino de conversiones: no se pudo comprobar" },
  "Permissão de envio": { es: "Permiso de envío" },
  "Permissão de envio: a Meta não lista neste token": { es: "Permiso de envío: Meta no lo lista en este token" },
  "Permissão de envio: não deu para conferir": { es: "Permiso de envío: no se pudo comprobar" },
  "Último envio aceito": { es: "Último envío aceptado" },
  "Último envio aceito há mais de 14 dias": { es: "Último envío aceptado hace más de 14 días" },
  "Nenhum envio aceito até aqui": { es: "Ningún envío aceptado hasta ahora" },
  "Eventos recusados nos últimos 7 dias: 0": { es: "Eventos rechazados en los últimos 7 días: 0" },
  "Eventos recusados nos últimos 7 dias": { es: "Eventos rechazados en los últimos 7 días" },
  "Modo de teste ligado": { es: "Modo de prueba activado" },
  "Preencha o identificador do destino de conversões e o token na aba Configuração. Até lá nada é enviado à Meta.":
    {
      es: "Completa el identificador del destino de conversiones y el token en la pestaña Configuración. Hasta entonces no se envía nada a Meta.",
    },
  "A conexão existe e o envio está desligado: nem a compra nem as etapas vão para a Meta. Ligue o envio na aba Configuração para testar a conexão.":
    {
      es: "La conexión existe y el envío está desactivado: ni la compra ni las etapas van a Meta. Activa el envío en la pestaña Configuración para probar la conexión.",
    },
  "Falta o identificador do destino ou o token. Complete na aba Configuração.": {
    es: "Falta el identificador del destino o el token. Complétalo en la pestaña Configuración.",
  },
  "Esta instalação está sem a chave mestra de criptografia. Quem instalou o sistema precisa configurá-la; reconectar pela tela não resolve.":
    {
      es: "Esta instalación no tiene la clave maestra de cifrado. Quien instaló el sistema necesita configurarla; reconectar desde la pantalla no lo resuelve.",
    },
  "Tente de novo em instantes.": { es: "Inténtalo de nuevo en instantes." },
  "A Meta aceitou o token guardado.": { es: "Meta aceptó el token guardado." },
  "O token venceu ou foi revogado. Gere um token novo na Meta e troque na aba Configuração.": {
    es: "El token venció o fue revocado. Genera un token nuevo en Meta y cámbialo en la pestaña Configuración.",
  },
  "A Meta não respondeu sobre o token. Tente de novo em instantes.": {
    es: "Meta no respondió sobre el token. Inténtalo de nuevo en instantes.",
  },
  "O token alcança este destino de conversões.": { es: "El token alcanza este destino de conversiones." },
  "O identificador não existe na Meta, ou o token não o alcança. Confira o número no gerenciador de eventos e corrija na aba Configuração.":
    {
      es: "El identificador no existe en Meta, o el token no lo alcanza. Comprueba el número en el administrador de eventos y corrígelo en la pestaña Configuración.",
    },
  "O token existe, mas não pode usar este destino. Peça acesso de administrador ao destino de conversões e gere o token de novo.":
    {
      es: "El token existe, pero no puede usar este destino. Pide acceso de administrador al destino de conversiones y genera el token de nuevo.",
    },
  "Depende de um token aceito.": { es: "Depende de un token aceptado." },
  "O token pode enviar eventos para este destino.": { es: "El token puede enviar eventos a este destino." },
  "Token gerado dentro do próprio destino de conversões envia mesmo assim. Para ter certeza, preencha o código de teste, mova um negócio e veja o evento chegar no gerenciador de eventos.":
    {
      es: "Un token generado dentro del propio destino de conversiones envía de todos modos. Para estar seguro, completa el código de prueba, mueve un negocio y mira llegar el evento en el administrador de eventos.",
    },
  "A Meta não informou as permissões deste token. O envio com o código de teste é o que decide.": {
    es: "Meta no informó los permisos de este token. El envío con el código de prueba es lo que decide.",
  },
  "A Meta está recebendo.": { es: "Meta está recibiendo." },
  "Confira se ainda chegam negócios de anúncio e se as regras das etapas estão ligadas.": {
    es: "Comprueba si siguen llegando negocios de anuncios y si las reglas de las etapas están activadas.",
  },
  "A Meta ainda não recebeu nada deste destino.": { es: "Meta aún no recibió nada de este destino." },
  "Nenhum evento recusado.": { es: "Ningún evento rechazado." },
  "Abra o histórico para ver cada evento e reenviar o que tem conserto.": {
    es: "Abre el historial para ver cada evento y reenviar lo que tiene arreglo.",
  },
  "Os envios vão marcados como teste e não contam para a otimização. Apague o código de teste quando terminar de conferir.":
    {
      es: "Los envíos van marcados como prueba y no cuentan para la optimización. Borra el código de prueba cuando termines de comprobar.",
    },
  "Conexão em ordem: a Meta está recebendo.": { es: "Conexión en orden: Meta está recibiendo." },
  "A Meta não está recebendo. Veja o item em vermelho.": { es: "Meta no está recibiendo. Mira el ítem en rojo." },
  "A conexão responde, mas há pontos de atenção.": { es: "La conexión responde, pero hay puntos de atención." },

  // ─── histórico de envios ───────────────────────────────────────────────────
  Situação: { es: "Situación" },
  "Limpar filtros": { es: "Limpiar filtros" },
  "do mais recente para o mais antigo": { es: "del más reciente al más antiguo" },
  "Enviado em": { es: "Enviado el" },
  Ação: { es: "Acción" },
  "não saiu": { es: "no salió" },
  Reenviar: { es: "Reenviar" },
  Enviado: { es: "Enviado" },
  "Recusado pela plataforma": { es: "Rechazado por la plataforma" },

  // ─── cartão aberto › Origem ────────────────────────────────────────────────
  "O que cada plataforma ficou sabendo": { es: "Lo que supo cada plataforma" },
  "Ver o histórico de envios": { es: "Ver el historial de envíos" },
  informado: { es: "informado" },
  informada: { es: "informada" },
  aguardando: { es: "en espera" },
  recusado: { es: "rechazado" },
  "não informada": { es: "no informada" },
  "informado à Meta em": { es: "informado a Meta el" },
  "informada à Meta em": { es: "informada a Meta el" },
  "na fila para ir à Meta": { es: "en cola para ir a Meta" },
  "recusado pela Meta em": { es: "rechazado por Meta el" },
  "recusada pela Meta em": { es: "rechazada por Meta el" },
  "não informado à Meta": { es: "no informado a Meta" },
  "não informada à Meta": { es: "no informada a Meta" },
  "informado ao Google Ads em": { es: "informado a Google Ads el" },
  "informada ao Google Ads em": { es: "informada a Google Ads el" },
  "na fila para ir ao Google Ads": { es: "en cola para ir a Google Ads" },
  "recusado pelo Google Ads em": { es: "rechazado por Google Ads el" },
  "recusada pelo Google Ads em": { es: "rechazada por Google Ads el" },
  "não informado ao Google Ads": { es: "no informado a Google Ads" },
  "não informada ao Google Ads": { es: "no informada a Google Ads" },
  "Nada foi informado à Meta: este negócio não veio de um anúncio desta plataforma.": {
    es: "No se informó nada a Meta: este negocio no vino de un anuncio de esta plataforma.",
  },
  "Nada foi informado à Meta até agora.": { es: "No se informó nada a Meta hasta ahora." },
  "Nada foi informado ao Google Ads: este negócio não veio de um anúncio desta plataforma.": {
    es: "No se informó nada a Google Ads: este negocio no vino de un anuncio de esta plataforma.",
  },
  "Nada foi informado ao Google Ads até agora.": { es: "No se informó nada a Google Ads hasta ahora." },
  "o negócio fechou sem valor": { es: "el negocio se cerró sin valor" },
  "nenhuma conta de anúncios conectada": { es: "ninguna cuenta de anuncios conectada" },
  "a conexão está desligada": { es: "la conexión está desactivada" },
  "a conexão está incompleta": { es: "la conexión está incompleta" },
  "falta a chave de criptografia do servidor": { es: "falta la clave de cifrado del servidor" },
  "plataforma sem envio de conversão": { es: "plataforma sin envío de conversión" },
  "evento de teste": { es: "evento de prueba" },
  "a plataforma recusou": { es: "la plataforma lo rechazó" },
  "sem clique de anúncio": { es: "sin clic en anuncio" },
};
