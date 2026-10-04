# Noir Club design specification

The generated desktop concept establishes a full-bleed, evergreen felt table with no rail, room or figures. Ivory cards and muted brass typography are the focal points. The UI uses open space, not enclosing panels. The controls sit in a translucent dark bottom band.

Tokens: felt #073c2f; deep surface #03251f; ivory #f8f2e6; brass #d7b780; muted #a4b8ac. Georgia/Times for wordmark, table lettering and totals; system sans-serif for labels and controls. Labels use restrained uppercase tracking.

Components: wordmark, utility buttons, dealer hand, curved rules printing, player hands, live session summary, bankroll, tactile chip selectors, action controls, rules dialog and stats drawer. Mobile keeps the same hierarchy with compact top utilities, separate betting row and full-width action controls. Short landscape screens may scroll instead of clipping cards.

Motion: cards enter from a nearby visible point above their resting position, rotate and settle with shadow. Hole card flips in place. The felt is a separate fixed background layer; every card ancestor allows visible overflow. Card stage never uses a clipping mask or 3D table plane.

Intentional implementation choices: ranks, suits and pip arrangements are code-native for accuracy and accessibility. Chip controls are CSS materials so denomination labels remain crisp. The generated felt and ornate card-back artwork are production assets. Default first visit shows a clearly decorative sample hand and a real zero-history session, rather than the concept's illustrative metrics. Audio starts on first interaction in accordance with browser playback requirements.
