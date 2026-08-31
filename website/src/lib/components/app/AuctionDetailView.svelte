<script lang="ts">
	import { Page, Navbar, Block, BlockTitle, Preloader, Button, Dialog, DialogButton } from 'konsta/svelte';
	import { telegramTrpc } from '$lib/trpc/telegramClient';
	import AuctionBalanceBadge from './AuctionBalanceBadge.svelte';

	let { auctionId, onBack, onChanged }: { auctionId: number; onBack: () => void; onChanged: () => void } = $props();

	// see LeilaoTab.svelte's note - Date fields arrive as ISO strings over the wire.
	type Details = {
		auction: {
			id: number;
			startingBid: number;
			capPrice: number;
			currentBid: number | null;
			bidIncrement: number;
			overtimeIncrement: number;
			status: string;
			expiresAt: string;
		};
		cardName: string;
		cardImageUrl: string | null;
		rarityEmoji: string;
		sellerName: string;
		categoryName: string;
		categoryEmoji: string;
		bids: { id: number; bidderName: string; bidderAvatarUrl: string; amount: number }[];
	};

	let details = $state<Details | null>(null);
	let loading = $state(true);
	let bidding = $state(false);
	let customAmount = $state('');
	let pendingBidAmount = $state<number | null>(null);
	let error = $state<string | null>(null);
	let brokenAvatars = $state(new Set<number>());
	let now = $state(Date.now());

	async function load() {
		loading = true;
		details = (await telegramTrpc.telegram.auctions.get.query({ id: auctionId })) as Details | null;
		loading = false;
	}
	load();

	$effect(() => {
		const interval = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(interval);
	});

	// same format as AuctionRows.svelte's list preview, kept in sync deliberately
	function timeLeft(expiresAt: string): string {
		const ms = new Date(expiresAt).getTime() - now;
		if (ms <= 0) return 'Terminando...';
		const totalSeconds = Math.floor(ms / 1000);
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		if (hours > 0) return `${hours}h ${minutes}min`;
		return `${minutes}min ${String(totalSeconds % 60).padStart(2, '0')}s`;
	}

	let msLeft = $derived(details ? new Date(details.auction.expiresAt).getTime() - now : Infinity);
	let isUrgent = $derived(msLeft < 2 * 60 * 1000);
	let isWarning = $derived(msLeft >= 2 * 60 * 1000 && msLeft < 5 * 60 * 1000);

	function minimumBid(): number {
		if (!details) return 0;
		const a = details.auction;
		const inOvertime = new Date(a.expiresAt).getTime() - Date.now() < 2 * 60 * 1000;
		const step = inOvertime ? a.overtimeIncrement : a.bidIncrement;
		return a.currentBid !== null ? a.currentBid + step : a.startingBid;
	}

	function bidErrorMessage(reason: string): string {
		switch (reason) {
			case 'not_a_valid_step':
				return `Valor inválido — o lance tem que ser um número inteiro, sempre de ${(details?.auction.bidIncrement ?? 500).toLocaleString('en-US')} em ${(details?.auction.bidIncrement ?? 500).toLocaleString('en-US')} (sem casas decimais).`;
			case 'below_minimum':
				return `Lance mínimo agora é ${minimumBid().toLocaleString('en-US')} moedas.`;
			case 'above_cap':
				return 'Valor acima do teto do leilão.';
			case 'self_bid':
				return 'Você não pode dar lance no seu próprio leilão.';
			case 'self_rebid':
				return 'Você já é o maior lance — espera alguém te ultrapassar antes de dar lance de novo.';
			case 'insufficient_coins':
				return 'Moedas insuficientes pra esse lance.';
			case 'not_active':
			case 'expired':
				return 'Esse leilão já não está mais ativo.';
			case 'auctions_disabled':
				return 'Os leilões estão temporariamente desativados.';
			default:
				return 'Não deu pra registrar o lance.';
		}
	}

	function requestBid(amount: number) {
		if (!amount || amount <= 0) return;
		error = null;
		if (!Number.isInteger(amount) || amount % (details?.auction.bidIncrement ?? 500) !== 0) {
			error = bidErrorMessage('not_a_valid_step');
			return;
		}
		pendingBidAmount = amount;
	}

	async function confirmBid() {
		const amount = pendingBidAmount;
		if (amount === null) return;
		bidding = true;
		const result = await telegramTrpc.telegram.auctions.bid.mutate({ auctionId, amount });
		bidding = false;
		pendingBidAmount = null;
		if (!result.ok) {
			error = bidErrorMessage(result.reason);
			return;
		}
		customAmount = '';
		onChanged();
		await load();
	}
</script>

<Page class="pb-safe-24">
	<Navbar title="Leilão">
		{#snippet left()}
			<button type="button" onclick={onBack} class="px-2 text-black dark:text-white">← Voltar</button>
		{/snippet}
		{#snippet right()}
			<AuctionBalanceBadge />
		{/snippet}
	</Navbar>

	{#if loading}
		<div class="flex justify-center p-8"><Preloader /></div>
	{:else if !details}
		<div class="p-8 text-center text-black/55 dark:text-white/55">Leilão não encontrado.</div>
	{:else}
		<BlockTitle>{details.categoryEmoji} {details.categoryName}</BlockTitle>
		<Block class="flex gap-4">
			{#if details.cardImageUrl}
				<div class="aspect-3/4 w-1/3 shrink-0 rounded-lg bg-cover bg-center" style={`background-image: url(${details.cardImageUrl})`}></div>
			{:else}
				<div class="flex aspect-3/4 w-1/3 shrink-0 items-center justify-center rounded-lg bg-black/5 dark:bg-white/10">
					<Preloader />
				</div>
			{/if}
			<div class="flex flex-1 flex-col">
				<div class="flex items-center justify-between gap-2">
					<p class="text-lg text-black dark:text-white"><strong>Leilão {details.auction.id}</strong></p>
					{#if details.auction.status === 'active'}
						<span
							class={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold whitespace-nowrap ${
								isUrgent
									? 'bg-red-500/15 text-red-500'
									: isWarning
										? 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400'
										: 'bg-black/5 text-black/70 dark:bg-white/10 dark:text-white/70'
							}`}
						>
							⏳ {timeLeft(details.auction.expiresAt)}
						</span>
					{/if}
				</div>
				<p class="mt-1 text-xl font-black text-black dark:text-white">{details.rarityEmoji} {details.cardName}</p>
				<p class="mt-1 text-lg text-black/55 dark:text-white/55">Vendedor: {details.sellerName}</p>

				<div class="mt-auto flex flex-col gap-3 pt-4">
					<p class="text-lg text-black dark:text-white">
						{details.auction.currentBid !== null ? 'Lance atual' : 'Lance inicial'}:
						<strong>{(details.auction.currentBid ?? details.auction.startingBid).toLocaleString('en-US')}</strong> moedas
					</p>
					<p class="text-lg text-black dark:text-white">
						Teto: <strong>{details.auction.capPrice.toLocaleString('en-US')}</strong> moedas
					</p>
				</div>
			</div>
		</Block>

		{#if error}<p class="px-4 text-red-500">{error}</p>{/if}

		{#if details.auction.status === 'active'}
			<Block>
				<Button rounded disabled={bidding} onClick={() => requestBid(minimumBid())}>
					{#if bidding}
						<Preloader colors={{ iconIos: 'text-white', iconMaterial: 'text-white' }} class="h-4 w-4" />
					{:else}
						Lance mínimo ({minimumBid().toLocaleString('en-US')})
					{/if}
				</Button>
			</Block>

			<Block class="mt-6">
				<input
					type="number"
					inputmode="numeric"
					step={details.auction.bidIncrement}
					min={minimumBid()}
					placeholder="Insira o seu valor"
					value={customAmount}
					oninput={(e: Event) => (customAmount = (e.target as HTMLInputElement).value)}
					class="w-full rounded-lg border border-black/10 bg-black/5 px-4 py-3 text-center text-black outline-none placeholder:text-black/40 dark:border-white/15 dark:bg-white/10 dark:text-white dark:placeholder:text-white/40"
				/>
			</Block>

			<Block class="mt-3">
				<Button rounded disabled={bidding || !customAmount} onClick={() => requestBid(Number(customAmount))}>
					<span class="w-full text-center text-lg">Lance</span>
				</Button>
			</Block>
		{:else}
			<Block>
				<p class="text-black/55 dark:text-white/55">Este leilão já terminou (estado: {details.auction.status}).</p>
			</Block>
		{/if}

		{#if details.bids.length > 0}
			<BlockTitle>Últimos lances</BlockTitle>
			<div class="mt-3 flex flex-col gap-6 px-4">
				{#each details.bids as b, i (b.id)}
					<div class="flex items-center gap-4">
						<div class="relative shrink-0">
							{#if b.bidderAvatarUrl && !brokenAvatars.has(b.id)}
								<img
									src={b.bidderAvatarUrl}
									alt=""
									class={`rounded-full object-cover ${i === 0 ? 'h-11 w-11' : 'h-8 w-8'}`}
									onerror={() => (brokenAvatars = new Set([...brokenAvatars, b.id]))}
								/>
							{:else}
								<div class={`flex items-center justify-center rounded-full bg-black/10 font-semibold text-black/60 dark:bg-white/15 dark:text-white/60 ${i === 0 ? 'h-11 w-11 text-base' : 'h-8 w-8 text-xs'}`}>
									{b.bidderName.slice(0, 2).toUpperCase()}
								</div>
							{/if}
							{#if i === 0}
								<span class="absolute -top-2.5 left-1/2 -translate-x-1/2 text-base leading-none drop-shadow-sm">👑</span>
							{/if}
						</div>
						<div class="min-w-0 flex-1">
							<div class={`truncate font-bold text-black dark:text-white ${i === 0 ? 'text-lg' : 'text-sm'}`}>{b.bidderName}</div>
						</div>
						<div class={`shrink-0 font-semibold text-black dark:text-white ${i === 0 ? 'text-lg' : 'text-sm'}`}>
							{b.amount.toLocaleString('en-US')} moedas
						</div>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</Page>

<Dialog opened={pendingBidAmount !== null} onBackdropClick={bidding ? undefined : () => (pendingBidAmount = null)}>
	{#snippet title()}Confirmar lance{/snippet}
	Dar um lance de <strong>{(pendingBidAmount ?? 0).toLocaleString('en-US')}</strong> moedas neste leilão?
	{#snippet buttons()}
		<DialogButton disabled={bidding} onClick={() => (pendingBidAmount = null)}>Cancelar</DialogButton>
		<DialogButton strong disabled={bidding} onClick={confirmBid}>
			{#if bidding}<Preloader class="h-4 w-4" />{:else}Confirmar{/if}
		</DialogButton>
	{/snippet}
</Dialog>
