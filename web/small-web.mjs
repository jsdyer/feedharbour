const cards = Array.from(document.querySelectorAll('[data-site]'));
const search = document.getElementById('site-search');
if (search && cards.length) {
  search.parentElement.hidden = false;
  const surprise = document.getElementById('random-site');
  surprise.hidden = false;
  surprise.addEventListener('click', () => {
    const visible = cards.filter(card => !card.hidden);
    if (visible.length) visible[Math.floor(Math.random() * visible.length)].querySelector('h3 a').click();
  });
  const fold = text => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
  search.addEventListener('input', () => {
    const terms = fold(search.value.trim()).split(/\s+/).filter(Boolean);
    for (const card of cards) card.hidden = !terms.every(term => fold(card.textContent).includes(term));
    const count = cards.filter(card => !card.hidden).length;
    surprise.disabled = count === 0;
    document.getElementById('filter-count').textContent = count ? `${count} of ${cards.length} sites` : 'No matching site. Try another place or topic.';
  });
}
