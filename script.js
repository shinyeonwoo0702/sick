document.addEventListener('DOMContentLoaded', function() {
    const dateInput = document.getElementById('meal-date');
    const searchBtn = document.getElementById('search-btn');
    const mealInfo = document.getElementById('meal-info');
    const loading = document.getElementById('loading');
    const errorMessage = document.getElementById('error-message');

    // 오늘 날짜를 기본값으로 설정
    const today = new Date();
    dateInput.value = today.toISOString().split('T')[0];

    // 검색 버튼 클릭 이벤트
    searchBtn.addEventListener('click', function() {
        const selectedDate = dateInput.value;
        if (selectedDate) {
            fetchMealInfo(selectedDate);
        } else {
            alert('날짜를 선택해주세요.');
        }
    });

    // 엔터키로도 검색 가능
    dateInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            searchBtn.click();
        }
    });

    // API 호출 함수
    async function fetchMealInfo(date) {
        // 로딩 표시
        showLoading();

        try {
            // 날짜 형식 변경 (YYYY-MM-DD -> YYYYMMDD)
            const formattedDate = date.replace(/-/g, '');
            
            // NEIS API URL (TYPE과 pIndex, pSize 파라미터 추가)
            const apiUrl = `https://open.neis.go.kr/hub/mealServiceDietInfo?KEY=&Type=xml&pIndex=1&pSize=100&ATPT_OFCDC_SC_CODE=J10&SD_SCHUL_CODE=7530478&MLSV_YMD=${formattedDate}`;
            
            console.log('API URL:', apiUrl);
            
            // 여러 CORS 프록시 시도
            const proxyUrls = [
                `https://api.allorigins.win/raw?url=${encodeURIComponent(apiUrl)}`,
                `https://corsproxy.io/?${encodeURIComponent(apiUrl)}`,
                `https://cors-anywhere.herokuapp.com/${apiUrl}`
            ];
            
            let response = null;
            let lastError = null;
            
            for (const proxyUrl of proxyUrls) {
                try {
                    console.log('시도 중인 프록시:', proxyUrl);
                    response = await fetch(proxyUrl);
                    if (response.ok) {
                        break;
                    }
                } catch (error) {
                    lastError = error;
                    console.warn('프록시 실패:', proxyUrl, error);
                    continue;
                }
            }
            
            if (!response || !response.ok) {
                throw new Error(`모든 프록시 서버 실패. 마지막 에러: ${lastError?.message || '알 수 없는 에러'}`);
            }
            
            const xmlText = await response.text();
            console.log('받은 XML 데이터:', xmlText);
            
            const mealData = parseXMLResponse(xmlText);
            
            displayMealInfo(mealData, date);

        } catch (error) {
            console.error('급식 정보를 가져오는데 실패했습니다:', error);
            showError(error.message);
        } finally {
            hideLoading();
        }
    }

    // XML 응답 파싱 함수
    function parseXMLResponse(xmlText) {
        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
            
            console.log('파싱된 XML 문서:', xmlDoc);
            
            // 파싱 에러 체크
            const parseError = xmlDoc.querySelector('parsererror');
            if (parseError) {
                console.error('XML 파싱 에러:', parseError.textContent);
                throw new Error('XML 파싱 실패');
            }
            
            // 에러 메시지 체크
            const errorElement = xmlDoc.querySelector('RESULT > MESSAGE');
            if (errorElement) {
                const errorMessage = errorElement.textContent;
                console.log('API 응답 메시지:', errorMessage);
                if (errorMessage.includes('해당하는 데이터가 없습니다') || errorMessage.includes('데이터가 없습니다')) {
                    return [];
                }
            }
            
            // 데이터 행 찾기
            const rows = xmlDoc.querySelectorAll('row');
            console.log('찾은 데이터 행 수:', rows.length);
            
            const meals = [];
            
            rows.forEach((row, index) => {
                console.log(`행 ${index + 1} 처리 중...`);
                
                const mealType = row.querySelector('MMEAL_SC_NM')?.textContent || '급식';
                const dishNames = row.querySelector('DDISH_NM')?.textContent || '';
                const calories = row.querySelector('CAL_INFO')?.textContent || '';
                const nutrition = row.querySelector('NTR_INFO')?.textContent || '';
                
                console.log('급식 타입:', mealType);
                console.log('메뉴:', dishNames);
                
                // 메뉴를 줄바꿈으로 분리
                const menuItems = dishNames.split('<br/>').filter(item => item.trim() !== '');
                
                if (menuItems.length > 0) {
                    meals.push({
                        type: mealType,
                        menu: menuItems,
                        calories: calories,
                        nutrition: nutrition
                    });
                }
            });
            
            console.log('최종 급식 데이터:', meals);
            return meals;
            
        } catch (error) {
            console.error('XML 파싱 중 에러:', error);
            throw new Error(`XML 파싱 실패: ${error.message}`);
        }
    }

    // 알레르기 정보 매핑
    const allergyMap = {
        '1': '난류', '2': '우유', '3': '메밀', '4': '땅콩', '5': '대두',
        '6': '밀', '7': '고등어', '8': '게', '9': '새우', '10': '돼지고기',
        '11': '복숭아', '12': '토마토', '13': '아황산류', '14': '호두',
        '15': '닭고기', '16': '쇠고기', '17': '오징어', '18': '조개류', '19': '잣'
    };

    // 알레르기 정보 파싱 함수
    function parseAllergyInfo(menuItem) {
        const allergyNumbers = menuItem.match(/(\d+)\./g);
        if (!allergyNumbers) return { cleanItem: menuItem, allergies: [] };

        const allergies = allergyNumbers.map(num => {
            const number = num.replace('.', '');
            return allergyMap[number] || number;
        });

        const cleanItem = menuItem.replace(/\d+\./g, '').trim();
        return { cleanItem, allergies };
    }

    // 급식 정보 표시 함수
    function displayMealInfo(meals, date) {
        if (meals.length === 0) {
            mealInfo.innerHTML = `
                <div class="meal-card">
                    <h2>급식 정보</h2>
                    <div class="date-info">
                        ${formatDate(date)} 급식 정보
                    </div>
                    <p class="instruction">해당 날짜의 급식 정보가 없습니다.</p>
                </div>
            `;
            return;
        }

        let html = `
            <div class="meal-card">
                <h2>급식 정보</h2>
                <div class="date-info">
                    ${formatDate(date)} 급식 정보
                </div>
        `;

        meals.forEach(meal => {
            html += `<h3>${meal.type}</h3>`;

            html += `<ul class="meal-list">`;

            meal.menu.forEach(item => {
                const { cleanItem, allergies } = parseAllergyInfo(item);
                if (cleanItem) {
                    html += `<li>
                        ${cleanItem}
                        ${allergies.length > 0 ? `<span class="allergy-info">(알레르기: ${allergies.join(', ')})</span>` : ''}
                    </li>`;
                }
            });

            html += '</ul>';

            if (meal.calories) {
                html += `<p><strong>칼로리:</strong> ${meal.calories}</p>`;
            }

            if (meal.nutrition) {
                html += `<p><strong>영양정보:</strong> ${meal.nutrition}</p>`;
            }
        });

        html += '</div>';
        mealInfo.innerHTML = html;
    }

    // 날짜 형식 변환 함수
    function formatDate(dateString) {
        const date = new Date(dateString);
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const day = date.getDate();
        const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
        const weekday = weekdays[date.getDay()];

        return `${year}년 ${month}월 ${day}일 (${weekday})`;
    }

    // 로딩 표시 함수들
    function showLoading() {
        loading.classList.remove('hidden');
        mealInfo.classList.add('hidden');
        errorMessage.classList.add('hidden');
    }

    function hideLoading() {
        loading.classList.add('hidden');
        mealInfo.classList.remove('hidden');
    }

    function showError(message = '급식 정보를 불러오는데 실패했습니다. 다시 시도해주세요.') {
        errorMessage.innerHTML = `<p>${message}</p>`;
        errorMessage.classList.remove('hidden');
        mealInfo.classList.add('hidden');
    }
});