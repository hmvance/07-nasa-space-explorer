// Find our date picker inputs on the page
const startInput = document.getElementById('startDate');
const endInput = document.getElementById('endDate');
const getImagesButton = document.getElementById('getImagesButton');
const gallery = document.getElementById('gallery');
const spaceFact = document.getElementById('spaceFact');
const imageModal = document.getElementById('imageModal');
const modalMedia = document.getElementById('modalMedia');
const modalDate = document.getElementById('modalDate');
const modalTitle = document.getElementById('modalTitle');
const modalExplanation = document.getElementById('modalExplanation');
const closeModalButton = document.getElementById('closeModalButton');
const apodApiUrl = 'https://science.nasa.gov/wp-json/wp/v2/apod-basic';
const apodPageSize = 25;

const spaceFacts = [
	'A day on Venus is longer than its year.',
	'Neutron stars can spin hundreds of times each second.',
	'The Sun contains about 99.8% of the mass in our solar system.',
	'Saturn would float in water if a large enough ocean existed, because its average density is lower than water.',
	'Light from the Sun takes about 8 minutes and 20 seconds to reach Earth.',
	'Footprints left by Apollo astronauts can last for millions of years on the Moon.',
	'Jupiter has the shortest day of all the planets in our solar system, at about 10 hours.',
	'A teaspoon of material from a neutron star would weigh about a billion tons on Earth.',
	'The International Space Station orbits Earth about once every 90 minutes.',
	'There are more stars in the observable universe than grains of sand on all of Earth’s beaches.',
	'Mars has the tallest volcano in the solar system: Olympus Mons.',
	'The Moon is moving away from Earth by about 3.8 centimeters each year.'
];

let activeRequest;
let modalOpener;

// Pick a new space fact whenever the page loads.
spaceFact.textContent = spaceFacts[Math.floor(Math.random() * spaceFacts.length)];

// Call the setupDateInputs function from dateRange.js
// This sets up the date pickers to:
// - Default to a range of 9 days (from 9 days ago to today)
// - Restrict dates to NASA's image archive (starting from 1995)
setupDateInputs(startInput, endInput);

// Load the selected dates when the user clicks the existing button.
getImagesButton.addEventListener('click', getSpaceImages);

async function getSpaceImages() {
	const startDate = startInput.value;
	const endDate = endInput.value;

	if (activeRequest) {
		activeRequest.abort();
		activeRequest = null;
	}

	if (!startDate || !endDate || startDate > endDate) {
		showGalleryMessage('Choose a valid start and end date.');
		return;
	}

	if (!startInput.checkValidity() || !endInput.checkValidity()) {
		showGalleryMessage('Choose dates between June 16, 1995 and today.');
		return;
	}

	const request = new AbortController();
	activeRequest = request;
	showGalleryMessage('🔄 Loading space photos...');

	const apiUrl = new URL(apodApiUrl);
	apiUrl.searchParams.set('date_from', startDate);
	apiUrl.searchParams.set('date_to', endDate);
	apiUrl.searchParams.set('per_page', apodPageSize);

	try {
		const response = await fetch(apiUrl, { signal: request.signal });
		const responseData = await response.json();
		let spacePhotos;

		if (response.ok && Array.isArray(responseData)) {
			const totalPages = Number(response.headers.get('X-WP-TotalPages')) || 1;
			const allResultsMatchRange = responseData.every((photo) => photo.date >= startDate && photo.date <= endDate);

			if (totalPages === 1 && allResultsMatchRange) {
				spacePhotos = responseData;
			} else {
				spacePhotos = await fetchApodDateRangeByPages(startDate, endDate, request.signal);
			}
		} else if (isDateFilterError(response.status, responseData)) {
			spacePhotos = await fetchApodDateRangeByPages(startDate, endDate, request.signal);
		} else {
			throw new Error('NASA could not load those photos. Please try again later.');
		}

		if (spacePhotos.length === 0) {
			showGalleryMessage('No space photos were found for that date range. Try different dates.');
			return;
		}

		displaySpacePhotos(spacePhotos);
	} catch (error) {
		if (!request.signal.aborted && error.name !== 'AbortError') {
			showGalleryMessage('NASA could not load those photos. Check your connection and try again later.');
		}
	} finally {
		if (activeRequest === request) {
			activeRequest = null;
		}
	}
}

function isDateFilterError(status, responseData) {
	return status === 400 &&
		responseData?.code === 'rest_invalid_param' &&
		(responseData.data?.params?.date_from || responseData.data?.params?.date_to);
}

async function fetchApodDateRangeByPages(startDate, endDate, signal) {
	const cachedPages = new Map();

	async function loadPage(pageNumber) {
		if (cachedPages.has(pageNumber)) {
			return cachedPages.get(pageNumber);
		}

		const pageUrl = new URL(apodApiUrl);
		pageUrl.searchParams.set('page', pageNumber);
		pageUrl.searchParams.set('per_page', apodPageSize);

		const response = await fetch(pageUrl, { signal });
		const pagePhotos = await response.json();

		if (!response.ok || !Array.isArray(pagePhotos)) {
			throw new Error('NASA could not load those photos. Please try again later.');
		}

		const page = {
			photos: pagePhotos,
			totalPages: Number(response.headers.get('X-WP-TotalPages')) || pageNumber
		};
		cachedPages.set(pageNumber, page);
		return page;
	}

	const firstPage = await loadPage(1);
	if (firstPage.photos.length === 0) {
		return [];
	}

	let startPage = 1;
	const totalPages = firstPage.totalPages;
	const oldestFirstPageDate = firstPage.photos[firstPage.photos.length - 1].date;

	if (endDate < oldestFirstPageDate && totalPages > 1) {
		let firstPageToCheck = 1;
		let lastPageToCheck = totalPages;

		while (firstPageToCheck < lastPageToCheck) {
			const middlePage = Math.floor((firstPageToCheck + lastPageToCheck) / 2);
			const page = await loadPage(middlePage);
			const newestDateOnPage = page.photos[0]?.date;

			if (!newestDateOnPage || newestDateOnPage > endDate) {
				firstPageToCheck = middlePage + 1;
			} else {
				lastPageToCheck = middlePage;
			}
		}

		startPage = Math.max(1, firstPageToCheck - 1);
	}

	const matchingPhotos = [];
	for (let pageNumber = startPage; pageNumber <= totalPages; pageNumber += 1) {
		const page = await loadPage(pageNumber);
		if (page.photos.length === 0) {
			break;
		}

		page.photos.forEach((photo) => {
			if (photo.date >= startDate && photo.date <= endDate) {
				matchingPhotos.push(photo);
			}
		});

		const oldestDateOnPage = page.photos[page.photos.length - 1].date;
		if (oldestDateOnPage < startDate) {
			break;
		}
	}

	return matchingPhotos;
}

function displaySpacePhotos(spacePhotos) {
	gallery.replaceChildren();

	spacePhotos.forEach((photo) => {
		if (photo.media_type === 'video') {
			createVideoCard(photo);
		} else if (photo.media_type === 'image') {
			createImageCard(photo);
		}
	});

	if (gallery.childElementCount === 0) {
		showGalleryMessage('No displayable space photos were found for that date range. Try different dates.');
	}
}

function createImageCard(photo) {
	const card = document.createElement('article');
	card.className = 'gallery-item';

	const imageButton = document.createElement('button');
	imageButton.className = 'gallery-image-button';
	imageButton.type = 'button';
	imageButton.setAttribute('aria-label', `View ${photo.title}`);

	const imageUrl = getApodImageUrl(photo);
	if (imageUrl) {
		const image = document.createElement('img');
		image.src = imageUrl;
		image.alt = photo.title;
		image.loading = 'lazy';
		image.addEventListener('error', () => {
			image.hidden = true;
			imageButton.classList.add('image-unavailable');
		}, { once: true });
		imageButton.append(image);
	} else {
		imageButton.classList.add('image-unavailable');
		imageButton.disabled = true;
	}
	imageButton.addEventListener('click', () => openImageModal(photo, imageButton));

	const details = createCardDetails(photo);
	card.append(imageButton, details);
	gallery.append(card);
}

function getApodImageUrl(photo) {
	if (typeof photo.hdurl === 'string' && photo.hdurl.startsWith('https://')) {
		return photo.hdurl;
	}

	if (typeof photo.url === 'string' && /\.(avif|gif|jpe?g|png|webp)(?:[?#]|$)/i.test(photo.url)) {
		return photo.url;
	}

	return '';
}

function createVideoCard(photo) {
	const card = document.createElement('article');
	card.className = 'gallery-item video-card';

	const videoPreview = document.createElement('div');
	videoPreview.className = 'video-preview';
	videoPreview.setAttribute('aria-hidden', 'true');

	const imageUrl = getApodImageUrl(photo);
	if (imageUrl) {
		const previewImage = document.createElement('img');
		previewImage.src = imageUrl;
		previewImage.alt = '';
		previewImage.loading = 'lazy';
		previewImage.addEventListener('error', () => previewImage.remove(), { once: true });
		videoPreview.append(previewImage);
	}

	const playIcon = document.createElement('span');
	playIcon.className = 'video-play-icon';
	playIcon.textContent = '▶';
	videoPreview.append(playIcon);

	const details = createCardDetails(photo);
	const videoLink = document.createElement('a');
	videoLink.className = 'watch-video-link';
	videoLink.href = photo.url;
	videoLink.target = '_blank';
	videoLink.rel = 'noopener noreferrer';
	videoLink.textContent = 'Watch Video ↗';

	card.append(videoPreview, details, videoLink);
	gallery.append(card);
}

function createCardDetails(photo) {
	const details = document.createElement('div');
	details.className = 'gallery-details';

	const date = document.createElement('p');
	date.className = 'photo-date';
	date.textContent = photo.date;

	const title = document.createElement('h2');
	title.className = 'photo-title';
	title.textContent = photo.title;

	details.append(date, title);
	return details;
}

function showGalleryMessage(message) {
	const placeholder = document.createElement('div');
	placeholder.className = 'placeholder';
	placeholder.setAttribute('role', 'status');
	placeholder.textContent = message;
	gallery.replaceChildren(placeholder);
}

function openImageModal(photo, opener) {
	modalOpener = opener;
	modalMedia.replaceChildren();

	const imageUrl = getApodImageUrl(photo);
	if (imageUrl) {
		const modalImage = document.createElement('img');
		modalImage.src = imageUrl;
		modalImage.alt = photo.title;
		modalImage.addEventListener('error', () => {
			modalImage.remove();
			showModalImageUnavailable();
		}, { once: true });
		modalMedia.append(modalImage);
	} else {
		showModalImageUnavailable();
	}

	function showModalImageUnavailable() {
		const unavailableMessage = document.createElement('p');
		unavailableMessage.className = 'modal-image-error';
		unavailableMessage.textContent = 'This image is unavailable right now.';
		modalMedia.append(unavailableMessage);
	}

	modalDate.textContent = photo.date;
	modalTitle.textContent = photo.title;
	modalExplanation.textContent = photo.explanation;
	imageModal.classList.add('is-open');
	imageModal.setAttribute('aria-hidden', 'false');
	document.body.classList.add('modal-open');
	closeModalButton.focus();
}

function closeImageModal() {
	imageModal.classList.remove('is-open');
	imageModal.setAttribute('aria-hidden', 'true');
	document.body.classList.remove('modal-open');

	if (modalOpener) {
		modalOpener.focus();
	}
}

closeModalButton.addEventListener('click', closeImageModal);
imageModal.addEventListener('click', (event) => {
	if (event.target === imageModal) {
		closeImageModal();
	}
});

document.addEventListener('keydown', (event) => {
	if (event.key === 'Escape' && imageModal.classList.contains('is-open')) {
		closeImageModal();
	}
});
