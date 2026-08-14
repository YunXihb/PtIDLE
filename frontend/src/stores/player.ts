import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { playerApi, warehouseApi, characterApi, cardApi } from '@/services/api';
import type { PlayerProfile, Warehouse, Character, DeckCard, PlayerCard, Pagination } from '@/types';

export const usePlayerStore = defineStore('player', () => {
  const profile = ref<PlayerProfile | null>(null);
  const warehouse = ref<Warehouse | null>(null);
  const characters = ref<Character[]>([]);
  const myCards = ref<PlayerCard[]>([]);
  const cardPagination = ref<Pagination | null>(null);

  const loaded = computed(() => !!profile.value);

  async function fetchProfile() {
    const res = await playerApi.profile();
    profile.value = res.data;
    characters.value = res.data.characters as unknown as Character[];
  }

  async function claimOffline() {
    const res = await playerApi.offlineClaim();
    return res.data;
  }

  async function fetchWarehouse() {
    const res = await warehouseApi.get();
    warehouse.value = res.data;
  }

  async function fetchCharacters() {
    const res = await characterApi.list();
    characters.value = res.data;
  }

  async function fetchMyCards(page = 1, pageSize = 50) {
    const res = await cardApi.myList(page, pageSize);
    myCards.value = res.data;
    cardPagination.value = res.pagination;
  }

  async function createCharacter(name: string, profession: string) {
    const res = await characterApi.create(name, profession);
    characters.value.push(res.data);
  }

  async function renameCharacter(id: string, name: string) {
    const res = await characterApi.rename(id, name);
    const idx = characters.value.findIndex((c) => c.id === id);
    if (idx >= 0) characters.value[idx] = res.data;
  }

  async function fetchDeck(characterId: string): Promise<DeckCard[]> {
    const res = await characterApi.deck(characterId);
    return res.data;
  }

  async function assignCard(characterId: string, cardId: string) {
    await characterApi.assignCard(characterId, cardId);
  }

  async function removeCard(characterId: string, cardId: string) {
    await characterApi.removeCard(characterId, cardId);
  }

  function reset() {
    profile.value = null;
    warehouse.value = null;
    characters.value = [];
    myCards.value = [];
    cardPagination.value = null;
  }

  return {
    profile, warehouse, characters, myCards, cardPagination, loaded,
    fetchProfile, claimOffline, fetchWarehouse, fetchCharacters, fetchMyCards,
    createCharacter, renameCharacter, fetchDeck, assignCard, removeCard, reset,
  };
});
