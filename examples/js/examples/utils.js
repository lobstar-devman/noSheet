function getRandomInt(max = Number.MAX_SAFE_INTEGER) {
  return Math.floor(Math.random() * max);
};

// Function to generate a random 5-character string
function generateRandomString(length) {
    const characters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
};

function getRandomData(num_rows = 10){
    return Array(getRandomInt(num_rows)+1).fill().map( e => [
                generateRandomString(10),  
                getRandomInt(10), 
                getRandomInt(20), 
                getRandomInt(30), 
            ]);
}

async function loadJSON(url){
        
    const response = await fetch(url);

    return response.ok ? await response.json() : [];
}

//populate prism 
document.addEventListener("DOMContentLoaded", (event) => { 

    Prism.plugins.NormalizeWhitespace.setDefaults({
        "remove-trailing": true,
        "remove-indent": true,
        "left-trim": true,
        "right-trim": true,
        "remove-initial-line-feed": true,        
        /*"break-lines": 80,
        "indent": 2,
        "tabs-to-spaces": 4,
        "spaces-to-tabs": 4*/
    });

    let count = 0;

    [...document.getElementsByTagName("script")].forEach(element => {
        
        element.innerHTML.split('//-prism').slice(1,-1).forEach( e => {

            let element = document.getElementById(`prism-${++count}`);
             
            if( element ){
                element.innerHTML = e;
                window.Prism.highlightElement(element);
            }
        });
    });

    [...document.getElementsByClassName("prism-fetch")].forEach(element => {

        fetch(
            element.getAttribute('src'), 
            {
                headers: [["Content-Type", "text/html"]]
        })
        .then((response) => response.text())
        .then((text) => {
            element.innerHTML = text;
            window.Prism.highlightElement(element);
        })
    });
})
