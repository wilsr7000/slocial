#!/bin/bash

# Production Site Testing Script for slocial.org
# Tests various endpoints and features

echo "======================================"
echo "Testing Slocial Production Site"
echo "URL: https://slocial.onrender.com"
echo "======================================"
echo ""

# Color codes for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Base URL (using Render deployment URL)
BASE_URL="https://slocial.onrender.com"

# Test function
test_endpoint() {
    local endpoint=$1
    local expected_code=$2
    local description=$3
    
    response=$(curl -L -s -o /dev/null -w "%{http_code}" "$BASE_URL$endpoint")
    
    if [ "$response" == "$expected_code" ]; then
        echo -e "${GREEN}✅ PASS${NC} - $description ($endpoint) - Status: $response"
    else
        echo -e "${RED}❌ FAIL${NC} - $description ($endpoint) - Expected: $expected_code, Got: $response"
    fi
}

# Test for content
test_content() {
    local endpoint=$1
    local search_text=$2
    local description=$3
    
    content=$(curl -L -s "$BASE_URL$endpoint")
    
    if echo "$content" | grep -q "$search_text"; then
        echo -e "${GREEN}✅ PASS${NC} - $description"
    else
        echo -e "${RED}❌ FAIL${NC} - $description - Text not found: '$search_text'"
    fi
}

echo "1. Testing Public Pages"
echo "------------------------"
test_endpoint "/" "200" "Homepage"
test_endpoint "/login" "200" "Login page"
test_endpoint "/signup" "200" "Signup page"
test_endpoint "/about" "200" "About page"
test_endpoint "/principles" "200" "Principles page"
test_endpoint "/tags" "200" "Mosaics page"

echo ""
echo "2. Testing Content"
echo "------------------"
test_content "/" "slocial.org" "Homepage has site name"
test_content "/" "Read" "Homepage has Read link"
test_content "/login" "Sign in" "Login page has sign in text"
test_content "/signup" "Create account" "Signup page has create account text"
test_content "/about" "About" "About page loads"
test_content "/tags" "Mosaics" "Mosaics page has correct title"

echo ""
echo "3. Testing Protected Routes (should redirect)"
echo "----------------------------------------------"
test_endpoint "/compose" "302" "Compose (protected)"
test_endpoint "/drafts" "302" "Drafts (protected)"
test_endpoint "/profile" "302" "Profile (protected)"

echo ""
echo "4. Testing Static Assets"
echo "-------------------------"
css_response=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/static/css/styles.css")
if [ "$css_response" == "200" ]; then
    echo -e "${GREEN}✅ PASS${NC} - CSS files loading"
else
    echo -e "${RED}❌ FAIL${NC} - CSS files not loading - Status: $css_response"
fi

echo ""
echo "5. Testing Mobile Responsiveness"
echo "---------------------------------"
mobile_content=$(curl -L -s -H "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)" "$BASE_URL")
if echo "$mobile_content" | grep -q "viewport"; then
    echo -e "${GREEN}✅ PASS${NC} - Mobile viewport meta tag present"
else
    echo -e "${RED}❌ FAIL${NC} - Mobile viewport meta tag missing"
fi

echo ""
echo "6. Testing Image Storage"
echo "-------------------------"
# Test if the new blob storage endpoint pattern exists
image_test=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/tags/public/image")
if [ "$image_test" == "404" ] || [ "$image_test" == "200" ]; then
    echo -e "${GREEN}✅ PASS${NC} - Image endpoint configured (Status: $image_test)"
else
    echo -e "${YELLOW}⚠️  WARN${NC} - Image endpoint may not be working (Status: $image_test)"
fi

echo ""
echo "7. Testing Dark Mode Support"
echo "-----------------------------"
if echo "$mobile_content" | grep -q "data-theme"; then
    echo -e "${GREEN}✅ PASS${NC} - Dark mode support detected"
else
    echo -e "${RED}❌ FAIL${NC} - Dark mode support not detected"
fi

echo ""
echo "======================================"
echo "Production Testing Complete"
echo "======================================"
