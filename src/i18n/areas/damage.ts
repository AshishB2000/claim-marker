/**
 * Messages for the damage step and its photo-first components: Damage.tsx, the camera, the
 * panels read off the photographs, the car to mark, and the thumbnails beside a mark.
 *
 * Panels, severities and body shapes are not here — they are `vocab`, because the marker, the
 * review and the desk all have to call a hood a hood. The assistant's own failure line is
 * `scene.assist.failed`, shared with the second look: it is one sentence, not two.
 *
 * Spanish: neutral Latin American, "tú". Where a label would have to agree with a body shape
 * whose gender we cannot know ("otro" / "otra" camioneta), the phrasing steps around it rather
 * than guessing — "Otro: {body}", "El otro vehículo ({name})", as `describe.ts` does.
 */
export const en = {
  // ── the lead under the step's heading, when the camera goes first
  'damage.head.lead': 'Photos first: we read the damage from them, and you check what we found. Then tap the car for anything they missed.',

  // ── which vehicle is being marked, when there is more than one
  'damage.chip.mine': 'Your {body}',
  'damage.chip.other': 'Other {body}',

  // ── the guided camera on a phone
  'damage.guided.title.mine': 'Photos of your {name}',
  'damage.guided.title.other': 'Photos of their {name}',
  'damage.guided.lead': 'Start with the photos. We read the damage from them, and you check what we found.',
  'damage.shot.close': 'The damage, close up',
  'damage.shot.back': 'The same, from a step back',
  'damage.shot.side': 'The whole side of the car',
  'damage.shot.other': 'The other vehicle and its plate',
  'damage.tile.taken': '{label}, taken — take it again',
  'damage.guided.choose': 'Choose from your photos',

  // ── the live camera sheet a guided tile opens; the per-shot instruction reuses damage.shot.*
  'damage.camera.title': 'Take the photo',
  'damage.camera.aria': 'Camera',
  'damage.camera.shutter': 'Take photo',
  'damage.camera.close': 'Close',
  'damage.camera.torch': 'Torch',
  'damage.camera.denied': 'We could not reach your camera. Use the button below instead.',
  'damage.camera.ready': 'Starting the camera…',
  'damage.camera.hint.hold_still': 'Hold still',
  'damage.camera.hint.too_dark': 'Too dark — turn on the light or move',
  'damage.camera.hint.too_bright': 'Too bright — move out of the glare',
  // the check behind this fires when the frame is almost featureless, which is what a panel
  // filling the whole frame looks like — so the fix is to back off a little, not lean in
  'damage.camera.hint.step_back': 'Step back a little',

  // ── the photo card everywhere else
  'damage.photos.title': 'Photos',
  'damage.photos.lead':
    'The damage up close and from a step back, the other vehicle, its plate, their insurance card, the scene. Photos are the first thing a claims handler looks at.',
  'damage.takePhoto': 'Take a photo',
  'damage.choosePhotos': 'Choose photos',
  'damage.addPhotos': 'Add photos',
  'damage.adding': 'Adding…',
  'damage.full': 'That is the most we can take — {n} photos.',
  'damage.count': '{n} of {max} photos',
  'damage.drop.count': 'Photos of {id} · {n} of {max} · or drop them here',

  // ── the photographs once they are on the claim
  'damage.photo.alt': 'Photo {n}',
  'damage.photo.remove': 'Remove photo {n}',
  'damage.photo.caption': 'What it shows',
  'damage.photo.captionAria': 'Caption for photo {n}',
  'damage.markPhoto.alt': 'Photo of this damage',

  // ── the panels the assistant read, asked for by a button
  'damage.suggest.title': 'From your photos',
  'damage.suggest.lead.one': 'We can look at the photo of this vehicle and suggest the panels. You decide what goes on the car.',
  'damage.suggest.lead.other': 'We can look at the {n} photos of this vehicle and suggest the panels. You decide what goes on the car.',
  'damage.suggest.looking': 'Looking…',
  'damage.suggest.again': 'Look again',
  'damage.suggest.button': 'Suggest from photos',
  'damage.suggest.nothing': 'Nothing clear enough to suggest.',
  'damage.suggest.add': 'Add {panel}',
  'damage.suggest.ai': 'Read by AI from the photos. It says what it can see, never what it would cost or who is at fault.',

  // ── the same panels, read by themselves, in photo-first order
  'damage.seen.aria': 'What the photos show',
  'damage.seen.title': 'What we can see in your photos',
  'damage.seen.looking': 'Looking at your photos…',
  'damage.seen.failed': 'We could not read the photos this time. Mark the damage on the car below.',
  'damage.seen.nothing': 'Nothing more to suggest. Mark anything else on the car below.',
  'damage.seen.notThis': 'Not this',
  'damage.seen.notThisAria': 'Not this: {panel}',
  'damage.seen.ai': 'Read by AI from your photos. Nothing goes on the car until you add it.',

  // ── the car itself
  'damage.missed.title': 'Anything the photos missed?',
  'damage.missed.lead': 'Tap it on the car.',
  'damage.auto.title': 'Marked for you: {panel}.',
  'damage.auto.lead':
    'Worked out from where the vehicles met and which way this one was facing. Tap the number on the car to change or remove it, or tap another panel to add more.',
  'damage.marker.title.mine': 'Your {name}',
  'damage.marker.title.other': 'Their {name}',
  'damage.marker.lead': 'Drag to turn the car round. Tap the panel where the damage is and say how bad it is. Tap a number to change or remove it.',
  'damage.marker.optional': 'Only if you saw it — this part is optional for other vehicles.',
  'damage.list.none': 'Nothing marked yet',
  'damage.list.one': '{n} marked',
  'damage.list.other': '{n} marked',

  // ── this vehicle's photos beside the car: dropped on a panel, each stands there as a card
  'damage.pinned.title': 'Photos of this vehicle',
  'damage.pinned.lead': 'Drag a photo onto the panel it shows, or choose the panel under it. It stands beside that panel on the car — tap it there to see it large.',
  'damage.pinned.shows': 'The panel photo {n} shows',
  'damage.pinned.none': 'Not one panel',

  // ── what happened, in the customer's words, when there was no diagram to draw
  'damage.describe.placeholder': "For example: I came out in the morning and the driver's window was smashed and the glovebox emptied.",

  // ── the state the car is in
  'damage.now.title': 'Your car now',
  'damage.now.lead': 'This decides whether we arrange a tow, a hire car, and where to send someone to look at it.',
  'damage.now.drivable': 'Can it be driven?',
  'damage.now.drivableAria': 'Can it be driven',
  'damage.now.airbags': 'Did the airbags go off?',
  'damage.now.airbagsAria': 'Did the airbags go off',
  'damage.now.towed': 'Was it towed?',
  'damage.now.towedAria': 'Was it towed',
  'damage.now.where': 'Where is it now?',
  'damage.now.whereAria': 'Where is the vehicle now',
  'damage.now.wherePlaceholder': "At home · the tow yard's name · the body shop · an address",

  // ── everything that was damaged and is not a vehicle
  'damage.property.title': 'Was anything else damaged?',
  'damage.property.lead': 'A fence, a pole, a wall, a parked bike — anything that is not a vehicle.',
  'damage.property.what': 'What was damaged',
  'damage.property.whatAria': 'Other property damaged',
  'damage.property.owner': 'Whose it is, if you know',
  'damage.property.ownerAria': 'Property owner',
} as const

export const es: Record<keyof typeof en, string> = {
  'damage.head.lead': 'Primero las fotos: leemos los daños en ellas y tú revisas lo que encontramos. Luego toca el auto para lo que falte.',

  'damage.chip.mine': 'Tu {body}',
  'damage.chip.other': 'Otro: {body}',

  'damage.guided.title.mine': 'Fotos de tu {name}',
  'damage.guided.title.other': 'Fotos del otro vehículo ({name})',
  'damage.guided.lead': 'Empieza por las fotos. Leemos los daños en ellas y tú revisas lo que encontramos.',
  'damage.shot.close': 'Los daños, de cerca',
  'damage.shot.back': 'Lo mismo, un paso atrás',
  'damage.shot.side': 'Todo el costado del auto',
  'damage.shot.other': 'El otro vehículo y su placa',
  'damage.tile.taken': '{label}, ya tomada — tómala otra vez',
  'damage.guided.choose': 'Elegir de tus fotos',

  'damage.camera.title': 'Toma la foto',
  'damage.camera.aria': 'Cámara',
  'damage.camera.shutter': 'Tomar foto',
  'damage.camera.close': 'Cerrar',
  'damage.camera.torch': 'Linterna',
  'damage.camera.denied': 'No pudimos usar tu cámara. Usa el botón de abajo en su lugar.',
  'damage.camera.ready': 'Iniciando la cámara…',
  'damage.camera.hint.hold_still': 'No te muevas',
  'damage.camera.hint.too_dark': 'Muy oscuro: enciende la luz o cambia de lugar',
  'damage.camera.hint.too_bright': 'Muy claro: aléjate del reflejo',
  'damage.camera.hint.step_back': 'Aléjate un poco',

  'damage.photos.title': 'Fotos',
  'damage.photos.lead':
    'Los daños de cerca y de un paso atrás, el otro vehículo, su placa, su tarjeta de seguro, el lugar. Las fotos son lo primero que revisa el equipo de reclamos.',
  'damage.takePhoto': 'Tomar una foto',
  'damage.choosePhotos': 'Elegir fotos',
  'damage.addPhotos': 'Agregar fotos',
  'damage.adding': 'Agregando…',
  'damage.full': 'Es el máximo que podemos recibir: {n} fotos.',
  'damage.count': '{n} de {max} fotos',
  'damage.drop.count': 'Fotos de {id} · {n} de {max} · o suéltalas aquí',

  'damage.photo.alt': 'Foto {n}',
  'damage.photo.remove': 'Quitar la foto {n}',
  'damage.photo.caption': 'Qué muestra',
  'damage.photo.captionAria': 'Descripción de la foto {n}',
  'damage.markPhoto.alt': 'Foto de estos daños',

  'damage.suggest.title': 'De tus fotos',
  'damage.suggest.lead.one': 'Podemos revisar la foto de este vehículo y sugerir las partes. Tú decides qué se marca en el auto.',
  'damage.suggest.lead.other': 'Podemos revisar las {n} fotos de este vehículo y sugerir las partes. Tú decides qué se marca en el auto.',
  'damage.suggest.looking': 'Revisando…',
  'damage.suggest.again': 'Revisar otra vez',
  'damage.suggest.button': 'Sugerir desde las fotos',
  'damage.suggest.nothing': 'Nada lo bastante claro para sugerir.',
  'damage.suggest.add': 'Agregar {panel}',
  'damage.suggest.ai': 'Leído por IA a partir de las fotos. Dice lo que se alcanza a ver, nunca cuánto costaría ni de quién fue la culpa.',

  'damage.seen.aria': 'Lo que muestran las fotos',
  'damage.seen.title': 'Lo que vemos en tus fotos',
  'damage.seen.looking': 'Revisando tus fotos…',
  'damage.seen.failed': 'Esta vez no pudimos leer las fotos. Marca los daños en el auto de abajo.',
  'damage.seen.nothing': 'Nada más que sugerir. Marca lo demás en el auto de abajo.',
  'damage.seen.notThis': 'Esto no',
  'damage.seen.notThisAria': 'Esto no: {panel}',
  'damage.seen.ai': 'Leído por IA a partir de tus fotos. Nada se marca en el auto hasta que tú lo agregues.',

  'damage.missed.title': '¿Falta algo que no salió en las fotos?',
  'damage.missed.lead': 'Tócalo en el auto.',
  'damage.auto.title': 'Lo marcamos por ti: {panel}.',
  'damage.auto.lead':
    'Lo dedujimos de dónde se encontraron los vehículos y hacia dónde apuntaba este. Toca el número en el auto para cambiarlo o quitarlo, o toca otra parte para agregar más.',
  'damage.marker.title.mine': 'Tu {name}',
  'damage.marker.title.other': 'El otro vehículo ({name})',
  'damage.marker.lead': 'Arrastra para girar el auto. Toca la parte donde están los daños y di qué tan graves son. Toca un número para cambiarlo o quitarlo.',
  'damage.marker.optional': 'Solo si lo viste: en los otros vehículos esta parte es opcional.',
  'damage.list.none': 'Nada marcado todavía',
  'damage.list.one': '{n} daño marcado',
  'damage.list.other': '{n} daños marcados',

  'damage.pinned.title': 'Fotos de este vehículo',
  'damage.pinned.lead': 'Arrastra una foto hasta la parte que muestra, o elige la parte debajo de ella. Quedará junto a esa parte en el auto: tócala ahí para verla en grande.',
  'damage.pinned.shows': 'La parte que muestra la foto {n}',
  'damage.pinned.none': 'Ninguna parte en concreto',

  'damage.describe.placeholder': 'Por ejemplo: salí en la mañana y la ventana del lado del conductor estaba rota y la guantera vacía.',

  'damage.now.title': 'Tu auto ahora',
  'damage.now.lead': 'Esto decide si te mandamos una grúa, un auto de reemplazo y a dónde enviamos a alguien a revisarlo.',
  'damage.now.drivable': '¿Se puede manejar?',
  'damage.now.drivableAria': 'Se puede manejar',
  'damage.now.airbags': '¿Se activaron las bolsas de aire?',
  'damage.now.airbagsAria': 'Se activaron las bolsas de aire',
  'damage.now.towed': '¿Se lo llevó una grúa?',
  'damage.now.towedAria': 'Se lo llevó una grúa',
  'damage.now.where': '¿Dónde está ahora?',
  'damage.now.whereAria': 'Dónde está el vehículo ahora',
  'damage.now.wherePlaceholder': 'En casa · el nombre del corralón · el taller · una dirección',

  'damage.property.title': '¿Se dañó algo más?',
  'damage.property.lead': 'Una reja, un poste, una pared, una bici estacionada: cualquier cosa que no sea un vehículo.',
  'damage.property.what': 'Qué se dañó',
  'damage.property.whatAria': 'Otros bienes dañados',
  'damage.property.owner': 'De quién es, si lo sabes',
  'damage.property.ownerAria': 'Dueño de los bienes',
}
