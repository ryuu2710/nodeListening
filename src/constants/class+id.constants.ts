export const AmazonHtmlSelectorManager = {
  product: {
    idSelectorsManager: {
      titleSelector: "#productTitle",
      totalRatingFromPurchasedGroupSelector: "span#acrCustomerReviewText",
      marketVolumeSelector: "span#social-proofing-faceout-title-tk_bought",
      retailerSelector: "a#sellerProfileTriggerId",
    },
    classSelectorsManager: {
      brandSelector: "table.a-normal.a-spacing-micro tbody tr.po-brand span.po-break-word",
      camelSite: {
        rawTableBodySelector: "div.table-scroll.camelegend table tbody tr.new td",
        rawTableSpecificationSelector: "table.product_fields tbody tr",
      }
    },
    compoundsManager: {
      currentPriceOnAmazonSite: ".priceToPay span[aria-hidden='true']",
      availability: "#availability span",
      totalRating: "div#averageCustomerReviews_feature_div div#averageCustomerReviews span.a-size-small.a-color-base",
      amazonChoiceSelector: [
        "div#value-pick-amazons-choice-view span.value-pick-aok-float-left.value-pick-ac-badge-rectangle",
        "span.aok-float-left.mvt-ac-badge-rectangle span"
      ],
      feedbackListSelector: "div#cm_cr-review_list ul[role='list'] li[data-hook='review']",
      feedbackDetails: {
        usernameSelector: "div[data-hook='genome-widget'] span.a-profile-name",
        feedbackDescriptionSelector: "div.review-data span[data-hook='review-body'] span",
      },
      button: {
        nextPage: "li.a-last:not(.a-disabled) > a"
      }
    },
    dataHookSelectorManager: {
      feedbackButtonSelector: "a[data-hook='see-all-reviews-link-foot']",
      feedbackDetails: {
        titleSelector: 'a[data-hook="review-title"] > span:last-of-type',
        ratingSelector: 'i[data-hook="review-star-rating"]',
        localeAndDateComponentSelector: "span[data-hook='review-date']",
        verifiedPurchaseSelector: "span[data-hook='avp-badge']",
        helpfulCountSelector: "span[data-hook='helpful-vote-statement']",
      }
    }
  },
};
