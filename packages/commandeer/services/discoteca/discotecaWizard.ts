import { DBOS } from '@dbos-inc/dbos-sdk'
import { AlbumsEndpointTypes, SongsEndpointTypes } from '@syncfm/applemusic-api'
import { reply, deleteMsg, awaitTextReply } from '@girae/common/dbos/messaging'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { AuditDB } from '@girae/database/audit'
import { DiscotecaDB } from '@girae/database/discoteca'
import { searchAlbums, searchSongs, resolveArtworkUrl, type AppleMusicSearchCandidate } from '@girae/services/apple-music/search'
import { getAlbum, getSong } from '@girae/services/apple-music/resource'
import { getOrProcessPreview } from '@girae/services/apple-music/preview'
import { getOrProcessAnimatedCover } from '@girae/services/apple-music/resource'
import { inferDiscotecaRarity } from './discotecaInference'
import { resolveCardByIdOrName, resolveDiscotecaAlbumByIdOrName } from '../commandArguments'
import type { IncomingCommand } from '@girae/common/commands/types'

const PICK_EVENT = 'discoteca:pick'
const CONFIRM_EVENT = 'discoteca:confirm'
const NAME_EVENT = 'discoteca:name'
const ADD_GENRE_EVENT = 'discoteca:addGenre'
const ARTIST_CARD_EVENT = 'discoteca:artistCard'
const ALBUM_EVENT = 'discoteca:album'
const MAX_CANDIDATES_SHOWN = 8

type PickAction = { index: number }
type ConfirmAction =
  | { action: 'rarity'; value: string }
  | { action: 'editName' }
  | { action: 'recheckGenres' }
  | { action: 'addGenre' }
  | { action: 'linkArtistCard' }
  | { action: 'changeAlbum' }
  | { action: 'confirm' }
  | { action: 'cancel' }
type Rarity = { id: number; name: string; emoji: string }
type ResolvedGenres = Awaited<ReturnType<typeof DiscotecaDB.resolveGenresByAliases>>
type Artist = { id: number; name: string; cardId: number | null }
type AlbumOption = { id: number; name: string } | null

function stripGenericMusicGenre(genreNames: string[]): string[] {
  return genreNames.filter(g => g.trim().toLowerCase() !== 'music')
}

// subcategories ending in "-pop" (K-Pop, J-Pop, C-Pop, V-Pop, Thai-Pop, ...) and Punk/Rock are mutually
// exclusive with everything else - a track is either firmly in one of them or not
const EXCLUSIVE_GENRE_MARKERS = ['punk/rock']
const EXCLUSIVE_GENRE_SUFFIX = '-pop'

function enforceExclusiveGenres(genres: ResolvedGenres): ResolvedGenres {
  const exclusive = genres.resolved.find(g => {
    const lower = g.name.toLowerCase()
    return lower.endsWith(EXCLUSIVE_GENRE_SUFFIX) || EXCLUSIVE_GENRE_MARKERS.some(marker => lower.includes(marker))
  })
  return exclusive ? { resolved: [exclusive], unmapped: genres.unmapped } : genres
}

function normalizeTrackName(name: string | undefined): string {
  return (name ?? '').trim().toLowerCase()
}

export async function runAddFlow(ctx: IncomingCommand, resourceType: 'single' | 'album', query: string): Promise<void> {
  const candidates = resourceType === 'album' ? await searchAlbums(query) : await searchSongs(query)
  if (candidates.length === 0) {
    await reply(ctx, `😅 Não encontrei nada no Apple Music para "${escapeMarkdown(query)}".`)
    return
  }

  const shown = candidates.slice(0, MAX_CANDIDATES_SHOWN)
  const pickOptions = shown.map((c, i) => ({
    title: `${i + 1}. ${c.name} — ${c.artistName}${c.releaseDate ? ` (${c.releaseDate.slice(0, 4)})` : ''}`,
    data: { index: i } as PickAction,
  }))

  const pickMessageId = await reply(ctx, {
    content: `🔍 **${candidates.length}** resultado(s) no Apple Music${candidates.length > shown.length ? ` (mostrando os ${shown.length} primeiros)` : ''}:`,
    eventName: PICK_EVENT,
    restricted: 'author',
    options: [...pickOptions, { title: '❌ Cancelar', data: { index: -1 } as PickAction }],
    rows: [...shown.map(() => 1), 1],
  })

  const pick = await DBOS.recv<{ value: PickAction, messageId?: string }>(PICK_EVENT)
  if (!pick) return
  const messageId = pick.messageId ?? pickMessageId

  if (pick.value.index === -1) {
    if (messageId) await deleteMsg(ctx, messageId)
    await reply(ctx, 'Adição cancelada.')
    return
  }

  const chosen = shown[pick.value.index]
  if (!chosen) return

  await runResourceConfirm(ctx, chosen, messageId, resourceType)
}

async function runConfirmLoop(
  ctx: IncomingCommand,
  messageId: string | undefined,
  photoUrl: string | undefined,
  buildPreview: (name: string, rarityName: string, rarityEmoji: string, genres: ResolvedGenres, artist: Artist, album: AlbumOption) => Promise<string>,
  initialName: string,
  initialRarityName: string,
  rarities: Rarity[],
  initialGenres: ResolvedGenres,
  reresolveGenres: (() => Promise<ResolvedGenres>) | undefined,
  resolveGenre: (raw: string) => Promise<{ id: number; name: string } | null>,
  initialArtist: Artist,
  initialAlbum: AlbumOption,
  showAlbumButton: boolean,
): Promise<{ name: string; rarityId: number; genres: ResolvedGenres; artist: Artist; album: AlbumOption; messageId?: string } | null> {
  let name = initialName
  let rarityName = initialRarityName
  let genres = initialGenres
  let artist = initialArtist
  let album = initialAlbum
  let currentMessageId = messageId

  while (true) {
    const rarity = rarities.find(r => r.name === rarityName) ?? rarities[0]!
    const options: { title: string; data: ConfirmAction }[] = [
      ...rarities.map(r => ({ title: `${r.emoji} ${r.name}`, data: { action: 'rarity', value: r.name } as ConfirmAction })),
      { title: '✏️ Nome', data: { action: 'editName' } as ConfirmAction },
    ]
    const genreButtons: { title: string; data: ConfirmAction }[] = []
    if (reresolveGenres) genreButtons.push({ title: '🔁 Rever gêneros', data: { action: 'recheckGenres' } as ConfirmAction })
    genreButtons.push({ title: '➕ Adicionar/remover gênero', data: { action: 'addGenre' } as ConfirmAction })
    options.push(...genreButtons)
    if (showAlbumButton) options.push({ title: '🔄 Trocar álbum', data: { action: 'changeAlbum' } as ConfirmAction })
    options.push(
      { title: '🎴 Vincular card do artista', data: { action: 'linkArtistCard' } as ConfirmAction },
      { title: '✅ Salvar', data: { action: 'confirm' } as ConfirmAction },
      { title: '❌ Cancelar', data: { action: 'cancel' } as ConfirmAction },
    )

    await reply(ctx, {
      content: await buildPreview(name, rarity.name, rarity.emoji, genres, artist, album),
      photoUrl,
      eventName: CONFIRM_EVENT,
      restricted: 'author',
      options,
      rows: [rarities.length, 1, genreButtons.length, ...(showAlbumButton ? [1] : []), 1, 1, 1],
      editMessageId: currentMessageId,
    })

    const selection = await DBOS.recv<{ value: ConfirmAction, messageId?: string }>(CONFIRM_EVENT)
    if (!selection) return null
    currentMessageId = selection.messageId ?? currentMessageId

    if (selection.value.action === 'cancel') {
      if (currentMessageId) await deleteMsg(ctx, currentMessageId)
      await reply(ctx, 'Adição cancelada.')
      return null
    }
    if (selection.value.action === 'rarity') { rarityName = selection.value.value; continue }
    if (selection.value.action === 'editName') {
      await reply(ctx, 'Envie o novo nome (texto simples).')
      await awaitTextReply(ctx, NAME_EVENT)
      const textReply = await DBOS.recv<{ value: string }>(NAME_EVENT)
      if (textReply?.value?.trim()) name = textReply.value.trim()
      continue
    }
    if (selection.value.action === 'recheckGenres') { if (reresolveGenres) genres = await reresolveGenres(); continue }
    if (selection.value.action === 'addGenre') {
      await reply(ctx, 'Envie o(s) nome(s) do(s) gênero(s) a adicionar ou remover, separados por vírgula (precisam já existir no catálogo).')
      await awaitTextReply(ctx, ADD_GENRE_EVENT)
      const textReply = await DBOS.recv<{ value: string }>(ADD_GENRE_EVENT)
      const genreNames = textReply?.value?.split(',').map(n => n.trim()).filter(Boolean) ?? []
      const notFound: string[] = []
      for (const genreName of genreNames) {
        const found = await resolveGenre(genreName)
        if (!found) { notFound.push(genreName); continue }
        if (genres.resolved.some(g => g.id === found.id)) {
          genres = { resolved: genres.resolved.filter(g => g.id !== found.id), unmapped: genres.unmapped }
        } else {
          genres = { resolved: [...genres.resolved, { id: found.id, name: found.name }], unmapped: genres.unmapped }
        }
      }
      if (notFound.length > 0) {
        await reply(ctx, `Não encontrei ${notFound.length === 1 ? 'o gênero' : 'os gêneros'}: ${notFound.map(escapeMarkdown).join(', ')}.`)
      }
      continue
    }
    if (selection.value.action === 'linkArtistCard') {
      await reply(ctx, 'Envie o ID ou nome do card do artista.')
      await awaitTextReply(ctx, ARTIST_CARD_EVENT)
      const textReply = await DBOS.recv<{ value: string }>(ARTIST_CARD_EVENT)
      const raw = textReply?.value?.trim()
      if (raw) {
        const cardOutcome = await resolveCardByIdOrName(raw)
        if (cardOutcome.ok) {
          const card = cardOutcome.value as { id: number; name: string }
          await DiscotecaDB.setArtistCard(artist.id, card.id, card.name)
          artist = { ...artist, cardId: card.id, name: card.name }
        } else if (cardOutcome.message) {
          await reply(ctx, cardOutcome.message)
        }
      }
      continue
    }
    if (selection.value.action === 'changeAlbum') {
      await reply(ctx, 'Envie o ID ou nome do álbum a vincular, ou "nenhum" para remover o vínculo.')
      await awaitTextReply(ctx, ALBUM_EVENT)
      const textReply = await DBOS.recv<{ value: string }>(ALBUM_EVENT)
      const raw = textReply?.value?.trim()
      if (raw) {
        if (raw.toLowerCase() === 'nenhum') {
          album = null
        } else {
          const albumOutcome = await resolveDiscotecaAlbumByIdOrName(raw)
          if (albumOutcome.ok) {
            const picked = albumOutcome.value as { id: number; name: string }
            album = { id: picked.id, name: picked.name }
          } else if (albumOutcome.message) {
            await reply(ctx, albumOutcome.message)
          }
        }
      }
      continue
    }
    if (selection.value.action === 'confirm') return { name, rarityId: rarity.id, genres, artist, album, messageId: currentMessageId }
  }
}

async function getStaffUser(ctx: IncomingCommand) {
  return UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
}

async function artistCardLine(artist: Artist): Promise<string> {
  if (artist.cardId) {
    const card = await CardsDB.getCardWithDetails(artist.cardId)
    if (card) return `🎧 Card do artista: ${card.rarityEmoji} \`${card.id}\`. **${escapeMarkdown(card.name)}**`
  }
  return `🎧 Nenhum card de artista encontrado para **${escapeMarkdown(artist.name)}**.`
}

async function runResourceConfirm(ctx: IncomingCommand, candidate: AppleMusicSearchCandidate, messageId: string | undefined, type: 'album' | 'single'): Promise<void> {
  const isAlbum = type === 'album'
  const typeEmoji = isAlbum ? '💿' : '🎵'
  const typeLabel = isAlbum ? 'álbum' : 'single'

  const detail = isAlbum ? await getAlbum(candidate.id) : await getSong(candidate.id)
  if (!detail) {
    await reply(ctx, { content: `😅 Não consegui buscar os detalhes desse ${typeLabel} no Apple Music. Tente de novo.`, editMessageId: messageId })
    return
  }

  const rarities = await CardsDB.getRarities()
  if (rarities.length === 0) { await reply(ctx, 'Não há raridades cadastradas ainda.'); return }

  const attrs = detail.attributes
  const apiArtist = detail.relationships?.artists?.data?.[0]
  const artist = await DiscotecaDB.getOrCreateArtist(
    apiArtist?.id ?? candidate.id,
    (apiArtist?.attributes as { name?: string } | undefined)?.name ?? attrs.artistName ?? candidate.artistName,
  )
  if (!artist) return

  const duplicate = await DiscotecaDB.findDuplicateEntry(attrs.name ?? candidate.name, artist.id, type)

  const genreNames = stripGenericMusicGenre(attrs.genreNames ?? [])
  const initialGenres = enforceExclusiveGenres(await DiscotecaDB.resolveGenresByAliases(genreNames, isAlbum))
  const suggestedRarity = await inferDiscotecaRarity(attrs.name ?? candidate.name, artist.name, type, rarities.map(r => r.name))
  const artworkUrl = resolveArtworkUrl(attrs.artwork, 1000)

  const buildPreview = async (name: string, rarityName: string, rarityEmoji: string, genres: ResolvedGenres, artist: Artist, album: AlbumOption) => {
    const genresLine = genres.resolved.length > 0 ? genres.resolved.map(g => escapeMarkdown(g.name)).join(', ') : '_nenhum gênero mapeado_'
    const unmappedWarning = genres.unmapped.length > 0 ? `\n⚠️ Gêneros não mapeados: ${genres.unmapped.map(escapeMarkdown).join(', ')}` : ''
    const duplicateWarning = duplicate ? `\n⚠️ Já existe um ${typeLabel} de **${escapeMarkdown(artist.name)}** com esse nome: \`${duplicate.id}\`. **${escapeMarkdown(duplicate.name)}**` : ''
    const artistLine = await artistCardLine(artist)
    const albumLine = !isAlbum ? (album ? `\n💽 Álbum sugerido: \`${album.id}\`. **${escapeMarkdown(album.name)}**` : `\n💽 Nenhum álbum vinculado.`) : ''
    return `${typeEmoji} **${escapeMarkdown(name)}**\n${escapeMarkdown(artist.name)}\n\n🎼 ${genresLine}${unmappedWarning}\n${artistLine}${albumLine}\n${rarityEmoji} ${escapeMarkdown(rarityName)}${duplicateWarning}`
  }

  let initialAlbum: AlbumOption = null
  if (!isAlbum) {
    const songDetail = detail as SongsEndpointTypes.SongResource
    const albumAppleMusicId = songDetail.relationships?.albums?.data?.[0]?.id
    const byId = albumAppleMusicId ? await DiscotecaDB.getEntryByAppleMusicId(albumAppleMusicId) : undefined
    const matched = byId ?? await DiscotecaDB.findAlbumTrackMatch(artist.id, normalizeTrackName(attrs.name ?? candidate.name))
    if (matched) initialAlbum = { id: matched.id, name: matched.name }
  }

  const outcome = await runConfirmLoop(
    ctx, messageId, artworkUrl, buildPreview,
    attrs.name ?? candidate.name, suggestedRarity ?? rarities[0]!.name, rarities,
    initialGenres, async () => enforceExclusiveGenres(await DiscotecaDB.resolveGenresByAliases(genreNames, isAlbum)),
    async raw => (await DiscotecaDB.resolveGenresByAliases([raw], isAlbum)).resolved[0] ?? null,
    artist, initialAlbum, !isAlbum,
  )
  if (!outcome) return

  const user = await getStaffUser(ctx)
  if (!user) return

  if (isAlbum) {
    const albumDetail = detail as AlbumsEndpointTypes.AlbumResource
    const albumAttrs = albumDetail.attributes

    if (outcome.messageId) {
      await reply(ctx, { content: 'Preparando cover animado... ⏳', photoUrl: artworkUrl, captionOnly: true, editMessageId: outcome.messageId })
    }

    const trackCount = albumDetail.relationships?.tracks?.data?.length ?? 0
    const animatedArtworkUrl = await getOrProcessAnimatedCover(candidate.id)

    const entry = await DiscotecaDB.createEntry({
      name: outcome.name,
      artistId: outcome.artist.id,
      appleMusicId: candidate.id,
      type: 'album',
      rarityId: outcome.rarityId,
      artworkUrl,
      animatedArtworkUrl: animatedArtworkUrl ?? undefined,
      appleMusicUrl: albumAttrs.url,
      releaseDate: albumAttrs.releaseDate ? new Date(albumAttrs.releaseDate) : undefined,
    })
    if (!entry) return

    await DiscotecaDB.setEntryGenres(entry.id, outcome.genres.resolved.map(g => g.id))
    await AuditDB.log(user.id, 'discoteca.create', { entryId: entry.id, name: entry.name, type: 'album', appleMusicId: candidate.id, trackCount })

    const albumTracks = (albumDetail.relationships?.tracks?.data ?? [])
      .map(t => ({ trackAppleMusicId: t.id, name: (t.attributes as { name?: string } | undefined)?.name }))
      .filter((t): t is { trackAppleMusicId: string; name: string } => !!t.name)
    await DiscotecaDB.cacheAlbumTracks(entry.id, albumTracks)

    // a single added before its album can't be id-matched later - Apple Music mints a new catalog id per track once it's on the album
    const trackNames = new Set((albumDetail.relationships?.tracks?.data ?? []).map(t => normalizeTrackName((t.attributes as { name?: string } | undefined)?.name)).filter(Boolean))
    const unlinkedSingles = await DiscotecaDB.getUnlinkedSinglesByArtist(outcome.artist.id)
    for (const single of unlinkedSingles) {
      if (trackNames.has(normalizeTrackName(single.name))) await DiscotecaDB.linkSingleToAlbum(single.id, entry.id)
    }

    const savedText = `💿 Álbum salvo: \`${entry.id}\`. **${escapeMarkdown(entry.name)}**`
    if (outcome.messageId) {
      await reply(ctx, {
        content: savedText,
        photoUrl: animatedArtworkUrl ?? artworkUrl,
        editMessageId: outcome.messageId,
        captionOnly: !animatedArtworkUrl,
      })
      return
    }
    await reply(ctx, { content: savedText, photoUrl: animatedArtworkUrl ?? artworkUrl })
    return
  }

  const songDetail = detail as SongsEndpointTypes.SongResource
  const songAttrs = songDetail.attributes
  const albumAppleMusicId = songDetail.relationships?.albums?.data?.[0]?.id
  const existingAlbum = outcome.album

  const previewUrl = songAttrs.previews?.[0]?.url
    ? await getOrProcessPreview({
        appleMusicTrackId: candidate.id,
        previewUrl: songAttrs.previews[0].url,
        title: outcome.name,
        artistName: outcome.artist.name,
        albumName: songAttrs.albumName,
        releaseDate: songAttrs.releaseDate,
        genre: genreNames[0],
        artwork: songAttrs.artwork,
      })
    : null

  const entry = await DiscotecaDB.createEntry({
    name: outcome.name,
    artistId: outcome.artist.id,
    appleMusicId: candidate.id,
    type: 'single',
    rarityId: outcome.rarityId,
    artworkUrl,
    appleMusicUrl: songAttrs.url,
    releaseDate: songAttrs.releaseDate ? new Date(songAttrs.releaseDate) : undefined,
    previewUrl: previewUrl ?? undefined,
    albumAppleMusicId,
    albumId: existingAlbum?.id,
  })
  if (!entry) return

  await DiscotecaDB.setEntryGenres(entry.id, outcome.genres.resolved.map(g => g.id))
  await AuditDB.log(user.id, 'discoteca.create', { entryId: entry.id, name: entry.name, type: 'single', appleMusicId: candidate.id, linkedAlbumId: existingAlbum?.id })

  if (outcome.messageId) await deleteMsg(ctx, outcome.messageId)

  const savedText = `🎵 Single salvo: \`${entry.id}\`. **${escapeMarkdown(entry.name)}**`
  if (previewUrl) {
    await reply(ctx, {
      content: savedText,
      audioUrl: previewUrl,
      audio: { entryId: entry.id, performer: outcome.artist.name, title: entry.name, thumbnailUrl: artworkUrl },
    })
    return
  }
  await reply(ctx, savedText)
}

export async function runEditFlow(ctx: IncomingCommand, entryId: number, type: 'album' | 'single'): Promise<void> {
  const isAlbum = type === 'album'
  const typeEmoji = isAlbum ? '💿' : '🎵'
  const typeLabel = isAlbum ? 'álbum' : 'single'

  const entry = await DiscotecaDB.getEntry(entryId)
  if (!entry) { await reply(ctx, `😅 Não encontrei esse ${typeLabel}.`); return }

  const rarities = await CardsDB.getRarities()
  if (rarities.length === 0) { await reply(ctx, 'Não há raridades cadastradas ainda.'); return }

  const artistRow = await DiscotecaDB.getArtist(entry.artistId)
  if (!artistRow) return
  const artist: Artist = { id: artistRow.id, name: artistRow.name, cardId: artistRow.cardId }

  const subcategoryRows = await DiscotecaDB.getSubcategoriesForEntry(entryId)
  const initialGenres: ResolvedGenres = { resolved: subcategoryRows, unmapped: [] }
  const currentRarity = rarities.find(r => r.id === entry.rarityId) ?? rarities[0]!

  let initialAlbum: AlbumOption = null
  if (!isAlbum && entry.albumId) {
    const albumEntry = await DiscotecaDB.getEntry(entry.albumId)
    if (albumEntry) initialAlbum = { id: albumEntry.id, name: albumEntry.name }
  }

  const buildPreview = async (name: string, rarityName: string, rarityEmoji: string, genres: ResolvedGenres, artist: Artist, album: AlbumOption) => {
    const genresLine = genres.resolved.length > 0 ? genres.resolved.map(g => escapeMarkdown(g.name)).join(', ') : '_nenhum gênero mapeado_'
    const artistLine = await artistCardLine(artist)
    const albumLine = !isAlbum ? (album ? `\n💽 Álbum: \`${album.id}\`. **${escapeMarkdown(album.name)}**` : '\n💽 Nenhum álbum vinculado.') : ''
    return `${typeEmoji} **${escapeMarkdown(name)}** _(editando \`${entryId}\`)_\n${escapeMarkdown(artist.name)}\n\n🎼 ${genresLine}${albumLine}\n${artistLine}\n${rarityEmoji} ${escapeMarkdown(rarityName)}`
  }

  const outcome = await runConfirmLoop(
    ctx, undefined, entry.artworkUrl ?? undefined, buildPreview,
    entry.name, currentRarity.name, rarities,
    initialGenres, undefined,
    async raw => (await DiscotecaDB.resolveGenresByAliases([raw], isAlbum)).resolved[0] ?? null,
    artist, initialAlbum, !isAlbum,
  )
  if (!outcome) return

  const user = await getStaffUser(ctx)
  if (!user) return

  await DiscotecaDB.updateEntry(entryId, {
    name: outcome.name,
    rarityId: outcome.rarityId,
    ...(isAlbum ? {} : { albumId: outcome.album?.id ?? null }),
  })
  await DiscotecaDB.setEntryGenres(entryId, outcome.genres.resolved.map(g => g.id))
  await AuditDB.log(user.id, 'discoteca.edit', { entryId, name: outcome.name, type })

  const savedText = `${typeEmoji} ${isAlbum ? 'Álbum' : 'Single'} atualizado: \`${entryId}\`. **${escapeMarkdown(outcome.name)}**`
  if (outcome.messageId) {
    await reply(ctx, { content: savedText, photoUrl: entry.artworkUrl ?? undefined, captionOnly: true, editMessageId: outcome.messageId })
    return
  }
  await reply(ctx, savedText)
}
