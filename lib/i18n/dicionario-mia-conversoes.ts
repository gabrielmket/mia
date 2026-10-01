/**
 * FORK MIA — as frases de tela das conversões da Meta por etapa do funil
 * (Configurações › Conversões e a seção Origem do cartão aberto), em espanhol.
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
  "Uma linha por etapa aberta do funil. Ligada, a Meta recebe o evento escolhido quando um negócio entra naquela etapa, uma vez por negócio. É a mesma régua que o Google Ads tem logo abaixo.":
    {
      es: "Una línea por etapa abierta del embudo. Activada, Meta recibe el evento elegido cuando un negocio entra en esa etapa, una vez por negocio. Es la misma regla que Google Ads tiene justo debajo.",
    },
  "Crie um funil com etapas para escolher o que cada etapa informa à Meta.": {
    es: "Crea un embudo con etapas para elegir lo que cada etapa informa a Meta.",
  },
  "A Meta ainda não está conectada. Você pode montar e salvar as regras; nada é enviado até a conexão acima estar preenchida e ligada.":
    {
      es: "Meta aún no está conectada. Puedes armar y guardar las reglas; no se envía nada hasta que la conexión de arriba esté completa y activada.",
    },
  "O envio está pausado no cartão da Meta: nem a compra nem as etapas vão para a Meta enquanto ele estiver desligado.":
    {
      es: "El envío está en pausa en la tarjeta de Meta: ni la compra ni las etapas van a Meta mientras esté desactivado.",
    },
  "etapas informando a Meta": { es: "etapas informando a Meta" },
  "alterações não salvas": { es: "cambios sin guardar" },
  "ª etapa": { es: "ª etapa" },
  "informa a Meta": { es: "informa a Meta" },
  "não informa": { es: "no informa" },
  "Informar a Meta na etapa": { es: "Informar a Meta en la etapa" },
  "Evento fora da lista da Meta para anúncio de WhatsApp: pode ser recusado ou não servir para otimizar. Confira com o código de teste.":
    {
      es: "Evento fuera de la lista de Meta para anuncios de WhatsApp: puede ser rechazado o no servir para optimizar. Compruébalo con el código de prueba.",
    },
  "Valor do evento (opcional)": { es: "Valor del evento (opcional)" },
  "Valor fixo em reais na etapa": { es: "Valor fijo en reales en la etapa" },
  "Valor do evento: sem valor, a Meta não aprende quanto vale um agendamento. Use um valor fixo (quanto vale, em média, aquele passo) ou o valor do negócio. Negócio sem valor envia o evento de etapa sem valor.":
    {
      es: "Valor del evento: sin valor, Meta no aprende cuánto vale una cita. Usa un valor fijo (cuánto vale, en promedio, ese paso) o el valor del negocio. Un negocio sin valor envía el evento de etapa sin valor.",
    },
  "As etapas de ganho e de perda não aparecem na lista. Ganho é a compra. Perda não é conversão.": {
    es: "Las etapas de ganado y de perdido no aparecen en la lista. Ganado es la compra. Perdido no es conversión.",
  },
  "Vale para os negócios que entrarem nas etapas a partir de agora.": {
    es: "Vale para los negocios que entren en las etapas a partir de ahora.",
  },
  "Regras salvas. Vale para os negócios que entrarem nas etapas a partir de agora.": {
    es: "Reglas guardadas. Vale para los negocios que entren en las etapas a partir de ahora.",
  },
  "Regras salvas. Vale para os negócios que entrarem nas etapas a partir de agora. Quem já está na etapa não é enviado.":
    {
      es: "Reglas guardadas. Vale para los negocios que entren en las etapas a partir de ahora. Quien ya está en la etapa no se envía.",
    },
  "Recomendado aplicado pelo nome das etapas. Etapas ligadas:": {
    es: "Recomendado aplicado por el nombre de las etapas. Etapas activadas:",
  },
  "Confira e salve.": { es: "Revisa y guarda." },
  "Toda etapa com valor fixo precisa de um valor maior que zero.": {
    es: "Toda etapa con valor fijo necesita un valor mayor que cero.",
  },
  "valor fixo": { es: "valor fijo" },
  "valor do negócio": { es: "valor del negocio" },
  "Sem valor": { es: "Sin valor" },
  "Valor fixo": { es: "Valor fijo" },
  "Valor do negócio": { es: "Valor del negocio" },
  "Novo lead": { es: "Nuevo lead" },
  Agendou: { es: "Agendó" },
  "Pediu orçamento ou proposta": { es: "Pidió presupuesto o propuesta" },
  "Iniciou a compra": { es: "Inició la compra" },
  "Todos os canais": { es: "Todos los canales" },
  "Só WhatsApp": { es: "Solo WhatsApp" },
  "Só fora do WhatsApp": { es: "Solo fuera de WhatsApp" },

  // ─── como a Meta vai enxergar o funil ──────────────────────────────────────
  "Como a Meta vai enxergar este funil": { es: "Cómo verá Meta este embudo" },
  "ao entrar em": { es: "al entrar en" },
  "repetido: não envia de novo para o mesmo negócio": { es: "repetido: no se envía de nuevo para el mismo negocio" },
  "quando o negócio é ganho": { es: "cuando el negocio se gana" },
  "valor do negócio, com a moeda dele": { es: "valor del negocio, con su moneda" },
  "desligada no cartão da Meta": { es: "desactivada en la tarjeta de Meta" },
  "Nenhuma etapa ligada: a Meta só fica sabendo da compra, como é hoje.": {
    es: "Ninguna etapa activada: Meta solo se entera de la compra, como hoy.",
  },
  "etapa informa a Meta antes da compra.": { es: "etapa informa a Meta antes de la compra." },
  "etapas informam a Meta antes da compra.": { es: "etapas informan a Meta antes de la compra." },
  "Quanto mais cedo o sinal, mais rápido o anúncio aprende quem vira cliente.": {
    es: "Cuanto antes llega la señal, más rápido aprende el anuncio quién se vuelve cliente.",
  },
  "Modo de teste ligado: nada disso conta para a otimização.": {
    es: "Modo de prueba activado: nada de esto cuenta para la optimización.",
  },
  "Só há o que informar quando o negócio veio de um clique em anúncio para o WhatsApp ou, com a chave abaixo ligada, de um formulário da Meta.":
    {
      es: "Solo hay algo que informar cuando el negocio vino de un clic en un anuncio hacia WhatsApp o, con la opción de abajo activada, de un formulario de Meta.",
    },

  // ─── leads de formulário voltam para a Meta ────────────────────────────────
  "Leads de formulário da Meta voltam para a Meta": { es: "Los leads de formulario de Meta vuelven a Meta" },
  "O sistema recebe os leads dos formulários da Meta e guarda o identificador de cada um, mas a Meta não fica sabendo quais viraram venda. Ligada, cada etapa com regra e a venda também são informadas para o lead que veio de formulário, mesmo sem clique em anúncio de WhatsApp.":
    {
      es: "El sistema recibe los leads de los formularios de Meta y guarda el identificador de cada uno, pero Meta no se entera de cuáles se volvieron venta. Activada, cada etapa con regla y la venta también se informan para el lead que vino de un formulario, incluso sin clic en un anuncio de WhatsApp.",
    },
  "Saem para a Meta o identificador do lead, o evento, o valor e o telefone e o e-mail do contato em forma embaralhada. Vem desligada: ligue só se a sua política de privacidade cobre esse uso. Ligar não envia o passado.":
    {
      es: "Salen hacia Meta el identificador del lead, el evento, el valor y el teléfono y el correo del contacto en forma cifrada. Viene desactivada: actívala solo si tu política de privacidad cubre ese uso. Activarla no envía lo pasado.",
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
  há: { es: "hace" },
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
  "Todas as situações": { es: "Todas las situaciones" },
  "Limpar filtros": { es: "Limpiar filtros" },
  "do mais recente para o mais antigo": { es: "del más reciente al más antiguo" },
  "Enviado em": { es: "Enviado el" },
  Ação: { es: "Acción" },
  "tentou em": { es: "intentó el" },
  "não saiu": { es: "no salió" },
  "Detalhes do envio": { es: "Detalles del envío" },
  "Última tentativa": { es: "Último intento" },
  "sem reenvio: passou de 7 dias": { es: "sin reenvío: pasaron más de 7 días" },
  Reenviar: { es: "Reenviar" },
  "Reenvio na fila, com os dados do primeiro envio.": { es: "Reenvío en cola, con los datos del primer envío." },
  Enviado: { es: "Enviado" },
  "Recusado pela plataforma": { es: "Rechazado por la plataforma" },
  "Não enviado · sem clique de anúncio": { es: "No enviado · sin clic en anuncio" },
  "Não enviado · sem valor": { es: "No enviado · sin valor" },
  "Não enviado · anterior à regra": { es: "No enviado · anterior a la regla" },
  "Não enviado · conexão ou modo de teste": { es: "No enviado · conexión o modo de prueba" },
  "Veio de formulário da Meta e a volta dos leads de formulário está desligada.": {
    es: "Vino de un formulario de Meta y el retorno de los leads de formulario está desactivado.",
  },
  "O negócio entrou na etapa antes de a regra ser ligada.": {
    es: "El negocio entró en la etapa antes de que la regla se activara.",
  },
  "Aconteceu antes de a volta dos leads de formulário ser ligada.": {
    es: "Ocurrió antes de que se activara el retorno de los leads de formulario.",
  },
  "O negócio não veio de um clique em anúncio desta plataforma.": {
    es: "El negocio no vino de un clic en un anuncio de esta plataforma.",
  },
  "Travas: envia uma vez por negócio e evento (sair e voltar à etapa não duplica); ligar uma regra não envia o passado; o reenvio usa o retrato do primeiro envio; a Meta recusa evento com mais de 7 dias.":
    {
      es: "Reglas fijas: envía una vez por negocio y evento (salir y volver a la etapa no duplica); activar una regla no envía lo pasado; el reenvío usa los datos del primer envío; Meta rechaza un evento con más de 7 días.",
    },
  "Negócio que não veio de anúncio nem de formulário não aparece aqui: não havia o que informar. O cartão do negócio diz isso na seção Origem.":
    {
      es: "Un negocio que no vino de un anuncio ni de un formulario no aparece aquí: no había nada que informar. La tarjeta del negocio lo dice en la sección Origen.",
    },

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
  "veio de formulário e a volta dos leads de formulário está desligada": {
    es: "vino de un formulario y el retorno de los leads de formulario está desactivado",
  },
  "entrou na etapa antes de a regra ser ligada": { es: "entró en la etapa antes de que la regla se activara" },
  "aconteceu antes de a volta dos leads de formulário ser ligada": {
    es: "ocurrió antes de que se activara el retorno de los leads de formulario",
  },
  "sem clique de anúncio": { es: "sin clic en anuncio" },
};
