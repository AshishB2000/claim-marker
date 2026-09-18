/** Messages for the shell and the sentences: App.tsx, ui.tsx, Done.tsx, Describe.tsx, offline.ts, submit.ts, config.ts, src/claim/describe.ts. */
export const en = {
  // ── the header
  'shell.title': 'Report an accident',
  // ── the other driver's page: the same seven steps, a different opening line
  'shell.title.party': 'Add your side',
  'shell.party.lead': 'Someone has reported an accident you were in and asked for your account of it. Nothing you write here is shown to them.',
  'shell.done.party.title': 'Your side is in',
  'shell.done.party.lead': 'Thank you. Both accounts now sit side by side with the insurer handling the claim.',
  /** the link has expired, was mistyped, or the server could not be reached */
  'shell.party.gone.title': 'This link has expired or cannot be opened',
  'shell.party.gone.lead': 'Ask the other driver for a new one. Links to add your side work for three days.',
  'shell.startOver': 'Start over',
  'shell.startOver.confirm': 'Start over? Everything you have entered will be cleared.',
  'shell.lang.label': 'Language',
  'shell.lang.en': 'English',
  'shell.lang.es': 'Spanish',

  // ── the progress bar, on a phone where the step names do not fit
  'shell.progress': 'Step {n} of {count}',

  // ── the heading and the line under it, per step
  'shell.head.kind.title': 'What happened?',
  'shell.head.kind.lead': 'Start with the kind of thing it was.',
  'shell.head.where.title': 'Where and when did it happen?',
  'shell.head.where.lead': 'Find the spot on the map. The next steps happen right there.',
  'shell.head.vehicles.title': 'Which vehicles were involved?',
  'shell.head.vehicles.lead': 'Yours first, then anyone else’s. Closest type and colour is fine.',
  /** the same step when the kind of incident has no other party */
  'shell.head.vehicles.one.title': 'Which vehicle is it?',
  'shell.head.vehicles.one.lead': 'The one on your policy. Closest type and colour is fine.',
  'shell.head.people.title': 'Who was there, and was anyone hurt?',
  'shell.head.people.lead': 'Drivers, passengers, witnesses, the police. Only what you know.',
  'shell.head.scene.collision.title': 'Show us what happened',
  'shell.head.scene.collision.lead': 'Put the vehicles where they ended up and draw where they came from.',
  'shell.head.scene.parked.title': 'Show us where it was',
  'shell.head.scene.parked.lead': 'Put your car where it was parked and, if you saw it, where the other vehicle came from.',
  'shell.head.scene.other.title': 'Show us what happened',
  'shell.head.scene.other.lead': 'Put your car where it ended up, draw where it came from, and tap where it hit.',
  'shell.head.damage.title': 'Where is the damage?',
  'shell.head.damage.lead': 'Tap the car where it is damaged, say how bad it is, and add photos if you have them.',
  'shell.head.review.title': 'Check it over',
  'shell.head.review.lead': 'This is what we will receive. Edit anything that is not right, then confirm and send.',

  // ── what has to be true before a step can be left
  'shell.need.where': 'Choose where it happened first',
  'shell.saved': 'Your progress is saved on this device until you send the report.',

  // ── the description box, typed or dictated
  'shell.describe.label': 'In your own words, what happened?',
  'shell.describe.say': 'Say it instead',
  'shell.describe.listening': 'Listening… tap to stop',

  // ── the page after it is sent
  'shell.done.sent.title': 'Your report is in',
  'shell.done.sent.lead': 'Keep this reference. You will need it if you call about the claim.',
  'shell.done.queued.title': 'Your report is saved',
  'shell.done.queued.lead':
    'There is no signal right now. It will send itself the moment your phone is back online — keep this page open, or come back to it.',
  'shell.done.ref': 'Reference',
  'shell.done.queued.ref': 'Reference · sending soon',
  'shell.done.next1': 'A claims handler reviews what you sent — the map, the vehicles and the damage you marked.',
  'shell.done.next2': 'If anything is unclear they will contact you, usually within one working day.',
  'shell.done.next3': 'You can arrange repairs once the claim is accepted.',
  'shell.done.download': 'Download a copy',
  'shell.done.again': 'Report another accident',

  // ── the shell offline
  'shell.offline.ready': 'Works offline now — you can finish this report without a signal.',

  // ── sending: only a refusal is ever shown to the customer, but all three can be
  'shell.send.failed': 'We could not send your report.',
  'shell.send.rejected': 'We could not send your report ({status}). Please check it over and try again.',
  'shell.send.error': 'We could not send your report ({status}).',

  // ── the optional assistant, when it cannot answer
  'shell.assist.off': 'The assistant is not switched on for this page.',
  'shell.assist.status': 'The assistant could not answer ({status}). Please try again, or fill it in yourself.',
  'shell.assist.shape': 'The assistant answered in a shape this page does not understand.',
  'shell.assist.empty': 'The assistant sent nothing back.',
  'shell.assist.noVehicle': 'The assistant was asked about a vehicle that is not in this report.',
  'shell.assist.noPhotos': 'There are no photos of this vehicle to look at.',
} as const

export const es: Record<keyof typeof en, string> = {
  'shell.title': 'Reportar un accidente',
  'shell.title.party': 'Agrega tu versión',
  'shell.party.lead': 'Alguien reportó un accidente en el que estuviste y pidió tu versión. Nada de lo que escribas aquí se le muestra.',
  'shell.done.party.title': 'Tu versión llegó',
  'shell.done.party.lead': 'Gracias. Ahora las dos versiones están lado a lado con la aseguradora que atiende el reclamo.',
  'shell.party.gone.title': 'Este enlace venció o no se puede abrir',
  'shell.party.gone.lead': 'Pídele uno nuevo al otro conductor. Los enlaces para agregar tu versión funcionan por tres días.',
  'shell.startOver': 'Empezar de nuevo',
  'shell.startOver.confirm': '¿Empezar de nuevo? Se borrará todo lo que hayas escrito.',
  'shell.lang.label': 'Idioma',
  'shell.lang.en': 'Inglés',
  'shell.lang.es': 'Español',

  'shell.progress': 'Paso {n} de {count}',

  'shell.head.kind.title': '¿Qué pasó?',
  'shell.head.kind.lead': 'Empieza por el tipo de incidente.',
  'shell.head.where.title': '¿Dónde y cuándo pasó?',
  'shell.head.where.lead': 'Encuentra el lugar en el mapa. Los siguientes pasos ocurren ahí mismo.',
  'shell.head.vehicles.title': '¿Qué vehículos estuvieron involucrados?',
  'shell.head.vehicles.lead': 'Primero el tuyo, después los demás. Basta con el tipo y el color más parecidos.',
  'shell.head.vehicles.one.title': '¿Cuál es el vehículo?',
  'shell.head.vehicles.one.lead': 'El de tu póliza. Basta con el tipo y el color más parecidos.',
  'shell.head.people.title': '¿Quiénes estaban ahí y alguien resultó herido?',
  'shell.head.people.lead': 'Quienes conducían, pasajeros, testigos, la policía. Solo lo que sepas.',
  'shell.head.scene.collision.title': 'Muéstranos qué pasó',
  'shell.head.scene.collision.lead': 'Pon los vehículos donde quedaron y dibuja de dónde venían.',
  'shell.head.scene.parked.title': 'Muéstranos dónde estaba',
  'shell.head.scene.parked.lead': 'Pon tu auto donde estaba estacionado y, si lo viste, de dónde venía el otro vehículo.',
  'shell.head.scene.other.title': 'Muéstranos qué pasó',
  'shell.head.scene.other.lead': 'Pon tu auto donde quedó, dibuja de dónde venía y toca dónde se golpeó.',
  'shell.head.damage.title': '¿Dónde están los daños?',
  'shell.head.damage.lead': 'Toca el auto donde está dañado, di qué tan graves son y agrega fotos si tienes.',
  'shell.head.review.title': 'Revísalo',
  'shell.head.review.lead': 'Esto es lo que vamos a recibir. Corrige lo que no esté bien, luego confirma y envía.',

  'shell.need.where': 'Primero elige dónde pasó',
  'shell.saved': 'Lo que llevas se guarda en este dispositivo hasta que envíes el reporte.',

  'shell.describe.label': 'Con tus palabras, ¿qué pasó?',
  'shell.describe.say': 'Dilo en voz alta',
  'shell.describe.listening': 'Escuchando… toca para detener',

  'shell.done.sent.title': 'Tu reporte llegó',
  'shell.done.sent.lead': 'Guarda este número de referencia. Lo vas a necesitar si llamas por el reclamo.',
  'shell.done.queued.title': 'Tu reporte está guardado',
  'shell.done.queued.lead':
    'Ahora mismo no hay señal. Se enviará solo en cuanto tu teléfono vuelva a tener conexión: deja esta página abierta o vuelve a ella.',
  'shell.done.ref': 'Referencia',
  'shell.done.queued.ref': 'Referencia · se enviará pronto',
  'shell.done.next1': 'El equipo de reclamos revisa lo que enviaste: el mapa, los vehículos y los daños que marcaste.',
  'shell.done.next2': 'Si algo no queda claro, te contactarán, por lo general en un día hábil.',
  'shell.done.next3': 'Puedes hacer las reparaciones una vez que se acepte el reclamo.',
  'shell.done.download': 'Descargar una copia',
  'shell.done.again': 'Reportar otro accidente',

  'shell.offline.ready': 'Ahora funciona sin conexión: puedes terminar este reporte sin señal.',

  'shell.send.failed': 'No pudimos enviar tu reporte.',
  'shell.send.rejected': 'No pudimos enviar tu reporte ({status}). Revísalo y vuelve a intentar.',
  'shell.send.error': 'No pudimos enviar tu reporte ({status}).',

  'shell.assist.off': 'El asistente no está activado en esta página.',
  'shell.assist.status': 'El asistente no pudo responder ({status}). Vuelve a intentar o complétalo tú.',
  'shell.assist.shape': 'El asistente respondió en un formato que esta página no entiende.',
  'shell.assist.empty': 'El asistente no envió nada.',
  'shell.assist.noVehicle': 'Le preguntamos al asistente por un vehículo que no está en este reporte.',
  'shell.assist.noPhotos': 'No hay fotos de este vehículo para revisar.',
}
